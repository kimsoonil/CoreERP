package dev.coreerp;

import static dev.coreerp.Models.*;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class MasterService {
  public enum Kind {
    SUPPLIERS("suppliers"),
    CUSTOMERS("customers"),
    WAREHOUSES("warehouses");
    public final String table;

    Kind(String t) {
      table = t;
    }
  }

  private final CoreMapper db;

  public MasterService(CoreMapper db) {
    this.db = db;
  }

  public static String prefix(String q) {
    return q.replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%";
  }

  public Page<Product> products(String q, int page, int size) {
    String p = prefix(q);
    return new Page<>(db.products(p, (long) page * size, size), db.productCount(p));
  }

  public Page<Master> list(Kind k, String q, int page, int size) {
    String p = prefix(q);
    return new Page<>(db.masters(k.table, p, (long) page * size, size), db.masterCount(k.table, p));
  }

  public Master required(Kind k, long id) {
    var m = db.master(k.table, id);
    if (m == null) throw BusinessException.missing();
    if (!m.active()) throw BusinessException.conflict("사용 중지된 " + k.table + "입니다.");
    return m;
  }

  public Product requiredProduct(long id) {
    var p = db.product(id);
    if (p == null) throw BusinessException.missing();
    if (!p.active()) throw BusinessException.conflict("사용 중지된 상품입니다.");
    return p;
  }

  @Transactional
  public long product(String actor, Long id, ProductInput input) {
    if (id == null) {
      id = db.createProduct(input);
    } else {
      requiredProduct(id);
      db.updateProduct(id, input);
    }
    db.audit(actor, "PRODUCT_SAVE", "PRODUCT", id, "{}");
    return id;
  }

  @Transactional
  public void disableProduct(String actor, long id) {
    requiredProduct(id);
    db.disableProduct(id);
    db.audit(actor, "PRODUCT_DISABLE", "PRODUCT", id, "{}");
  }

  @Transactional
  public long save(String actor, Kind k, Long id, MasterInput input) {
    if (id == null) id = db.createMaster(k.table, input);
    else {
      required(k, id);
      db.updateMaster(k.table, id, input);
    }
    db.audit(actor, "MASTER_SAVE", k.table, id, "{}");
    return id;
  }

  @Transactional
  public void disable(String actor, Kind k, long id) {
    required(k, id);
    db.disableMaster(k.table, id);
    db.audit(actor, "MASTER_DISABLE", k.table, id, "{}");
  }

  public Page<Inventory> inventory(Long warehouse, String q, boolean low, int page, int size) {
    String p = prefix(q);
    return new Page<>(
        db.inventory(warehouse, p, low, (long) page * size, size),
        db.inventoryCount(warehouse, p, low));
  }
}
