package dev.coreerp;

import static dev.coreerp.BusinessException.*;
import static dev.coreerp.MasterService.Kind.*;
import static dev.coreerp.Models.*;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class BusinessService {
  private final CoreMapper db;
  private final MasterService masters;
  private final com.fasterxml.jackson.databind.ObjectMapper json;

  public BusinessService(
      CoreMapper db, MasterService m, com.fasterxml.jackson.databind.ObjectMapper json) {
    this.db = db;
    masters = m;
    this.json = json;
  }

  private String details(Object value) {
    try {
      return json.writeValueAsString(value);
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  private String hash(Object o) {
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256")
                  .digest(o.toString().getBytes(StandardCharsets.UTF_8)));
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  private Long replay(String op, UUID key, Object content) {
    db.requestLock(op + ":" + key);
    var r = db.request(op, key);
    if (r == null) return null;
    if (!r.fingerprint().equals(hash(content))) throw conflict("같은 요청 키로 다른 내용을 처리할 수 없습니다.");
    return r.resultId();
  }

  private void save(String op, UUID key, Object content, long id) {
    db.saveRequest(op, key, hash(content), id);
  }

  private SortedMap<Long, Integer> lines(List<Line> input) {
    var map = new TreeMap<Long, Integer>();
    for (var l : input) {
      map.merge(l.productId(), l.quantity(), Integer::sum);
      if (map.get(l.productId()) > 1000000) throw conflict("품목 수량 상한을 초과했습니다.");
    }
    return map;
  }

  private Document purchase(long id, boolean lock) {
    var o = lock ? db.lockPurchase(id) : db.purchase(id);
    if (o == null) throw missing();
    return o;
  }

  private Document sale(long id, boolean lock) {
    var o = lock ? db.lockSale(id) : db.sale(id);
    if (o == null) throw missing();
    return o;
  }

  private Stock lock(long warehouse, long product) {
    db.ensureStock(warehouse, product);
    return db.lockStock(warehouse, product);
  }

  public Detail purchaseDetail(long id) {
    return new Detail(purchase(id, false), db.purchaseItems(id), null);
  }

  public Detail saleDetail(long id) {
    return new Detail(sale(id, false), db.saleItems(id), db.shipmentId(id));
  }

  @Transactional
  public long createPurchase(String actor, PurchaseInput in) {
    var normalized = new TreeMap<Long, BuyLine>();
    for (var l : in.items()) {
      var old = normalized.get(l.productId());
      if (old != null && old.unitPrice() != l.unitPrice()) throw conflict("동일 상품의 단가를 통일해 주세요.");
      int n = l.quantity() + (old == null ? 0 : old.quantity());
      if (n > 1000000) throw conflict("품목 수량 상한 초과");
      normalized.put(l.productId(), new BuyLine(l.productId(), n, l.unitPrice()));
    }
    var content = List.of(in.warehouseId(), in.supplierId(), normalized);
    Long prior = replay("PURCHASE", in.requestKey(), content);
    if (prior != null) return prior;
    masters.required(SUPPLIERS, in.supplierId());
    masters.required(WAREHOUSES, in.warehouseId());
    for (var l : normalized.values()) masters.requiredProduct(l.productId());
    long id = db.createPurchase(in.supplierId(), in.warehouseId(), actor);
    for (var l : normalized.values()) db.buyItem(id, l.productId(), l.quantity(), l.unitPrice());
    db.audit(actor, "PURCHASE_CREATE", "PURCHASE", id, "{}");
    save("PURCHASE", in.requestKey(), content, id);
    return id;
  }

  @Transactional
  public void approve(String actor, long id) {
    var o = purchase(id, true);
    if (o.status().equals("APPROVED")) return;
    if (!o.status().equals("DRAFT")) throw conflict("작성 중인 발주만 승인할 수 있습니다.");
    db.purchaseStatus(id, "APPROVED");
    db.audit(actor, "PURCHASE_APPROVE", "PURCHASE", id, "{}");
  }

  @Transactional
  public void cancelPurchase(String actor, long id) {
    var o = purchase(id, true);
    if (o.status().equals("CANCELLED")) return;
    if (!Set.of("DRAFT", "APPROVED").contains(o.status()))
      throw conflict("입고 이력이 있는 발주는 취소할 수 없습니다.");
    db.purchaseStatus(id, "CANCELLED");
    db.audit(actor, "PURCHASE_CANCEL", "PURCHASE", id, "{}");
  }

  @Transactional
  public long receive(String actor, long id, ReceiptInput in) {
    var quantities = lines(in.items());
    String op = "RECEIPT:" + id;
    Long prior = replay(op, in.requestKey(), quantities);
    if (prior != null) return prior;
    var o = purchase(id, true);
    if (!Set.of("APPROVED", "PARTIAL").contains(o.status()))
      throw conflict("승인 또는 부분 입고 발주만 입고할 수 있습니다.");
    var items = new HashMap<Long, Item>();
    for (var i : db.purchaseItems(id)) items.put(i.productId(), i);
    for (var e : quantities.entrySet()) {
      var i = items.get(e.getKey());
      if (i == null || e.getValue() > i.quantity() - i.processed())
        throw conflict("미입고 수량을 초과했습니다.");
      var stock = lock(o.warehouseId(), e.getKey());
      if ((long) stock.onHand() + e.getValue() > 1000000) throw conflict("재고 상한 초과");
    }
    long receipt = db.receipt(id, actor);
    for (var e : quantities.entrySet()) {
      db.stock(o.warehouseId(), e.getKey(), e.getValue(), 0);
      db.received(id, e.getKey(), e.getValue());
      db.receiptItem(receipt, e.getKey(), e.getValue());
      db.movement(o.warehouseId(), e.getKey(), e.getValue(), "RECEIPT", receipt, actor);
    }
    boolean done = db.purchaseItems(id).stream().allMatch(i -> i.quantity() == i.processed());
    db.purchaseStatus(id, done ? "RECEIVED" : "PARTIAL");
    db.audit(actor, "GOODS_RECEIPT", "PURCHASE", id, "{}");
    save(op, in.requestKey(), quantities, receipt);
    return receipt;
  }

  @Transactional
  public long createSale(String actor, SalesInput in) {
    var quantities = lines(in.items());
    var content = List.of(in.warehouseId(), in.customerId(), quantities);
    Long prior = replay("SALE", in.requestKey(), content);
    if (prior != null) return prior;
    masters.required(CUSTOMERS, in.customerId());
    masters.required(WAREHOUSES, in.warehouseId());
    var products = new TreeMap<Long, Product>();
    for (var e : quantities.entrySet()) {
      products.put(e.getKey(), masters.requiredProduct(e.getKey()));
      var stock = lock(in.warehouseId(), e.getKey());
      if (stock.onHand() - stock.reserved() < e.getValue())
        throw conflict("가용 재고가 부족합니다: " + products.get(e.getKey()).name());
    }
    long id = db.createSale(in.customerId(), in.warehouseId(), actor);
    for (var e : quantities.entrySet()) {
      db.stock(in.warehouseId(), e.getKey(), 0, e.getValue());
      db.saleItem(id, e.getKey(), e.getValue(), products.get(e.getKey()).price());
    }
    db.audit(actor, "SALE_RESERVE", "SALE", id, "{}");
    save("SALE", in.requestKey(), content, id);
    return id;
  }

  @Transactional
  public void cancelSale(String actor, long id) {
    var o = sale(id, true);
    if (o.status().equals("CANCELLED")) return;
    if (!o.status().equals("RESERVED")) throw conflict("출고 전 주문만 취소할 수 있습니다. 출고 취소 기능을 사용하세요.");
    for (var i : db.saleItems(id)) {
      lock(o.warehouseId(), i.productId());
      db.stock(o.warehouseId(), i.productId(), 0, -i.quantity());
    }
    db.saleStatus(id, "CANCELLED");
    db.audit(actor, "SALE_CANCEL", "SALE", id, "{}");
  }

  @Transactional
  public long ship(String actor, long id, RequestKey in) {
    String op = "SHIP";
    Long prior = replay(op, in.requestKey(), id);
    if (prior != null) return prior;
    var o = sale(id, true);
    if (o.status().equals("SHIPPED")) {
      long existing = db.shipmentId(id);
      save(op, in.requestKey(), id, existing);
      return existing;
    }
    if (!o.status().equals("RESERVED")) throw conflict("예약 상태의 주문만 출고할 수 있습니다.");
    var items = db.saleItems(id);
    for (var i : items) {
      var stock = lock(o.warehouseId(), i.productId());
      if (stock.reserved() < i.quantity() || stock.onHand() < i.quantity())
        throw conflict("출고 재고가 부족합니다.");
    }
    long shipment = db.shipment(id, actor);
    for (var i : items) {
      db.stock(o.warehouseId(), i.productId(), -i.quantity(), -i.quantity());
      db.shipmentItem(shipment, i.productId(), i.quantity());
      db.movement(o.warehouseId(), i.productId(), -i.quantity(), "SHIP", shipment, actor);
    }
    db.saleStatus(id, "SHIPPED");
    db.audit(actor, "SHIP_CONFIRM", "SALE", id, "{}");
    save(op, in.requestKey(), id, shipment);
    return shipment;
  }

  @Transactional
  public void cancelShipment(String actor, long id) {
    var o = sale(id, true);
    Long shipment = db.shipmentId(id);
    if (o.status().equals("CANCELLED") && shipment != null) return;
    if (!o.status().equals("SHIPPED")) throw conflict("출고 완료 주문만 출고 취소할 수 있습니다.");
    for (var i : db.saleItems(id)) {
      var s = lock(o.warehouseId(), i.productId());
      if ((long) s.onHand() + i.quantity() > 1000000) throw conflict("재고 상한 초과");
      db.stock(o.warehouseId(), i.productId(), i.quantity(), 0);
      db.movement(o.warehouseId(), i.productId(), i.quantity(), "SHIP_CANCEL", shipment, actor);
    }
    db.cancelShipment(id);
    db.saleStatus(id, "CANCELLED");
    db.audit(actor, "SHIP_CANCEL", "SALE", id, "{}");
  }

  @Transactional
  public void adjust(String actor, Adjustment in) {
    if (in.delta() == 0) throw conflict("조정 수량은 0일 수 없습니다.");
    var content = List.of(in.warehouseId(), in.productId(), in.delta(), in.reason());
    if (replay("ADJUST", in.requestKey(), content) != null) return;
    masters.required(WAREHOUSES, in.warehouseId());
    masters.requiredProduct(in.productId());
    var s = lock(in.warehouseId(), in.productId());
    long next = (long) s.onHand() + in.delta();
    if (next < s.reserved() || next > 1000000) throw conflict("예약 재고 이하로 조정하거나 상한을 초과할 수 없습니다.");
    db.stock(in.warehouseId(), in.productId(), in.delta(), 0);
    db.movement(in.warehouseId(), in.productId(), in.delta(), "ADJUST", null, actor);
    db.audit(
        actor,
        "STOCK_ADJUST",
        "PRODUCT",
        in.productId(),
        details(
            Map.of("warehouseId", in.warehouseId(), "delta", in.delta(), "reason", in.reason())));
    save("ADJUST", in.requestKey(), content, in.productId());
  }
}
