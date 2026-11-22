package dev.coreerp;

import static dev.coreerp.Models.*;

import java.time.OffsetDateTime;
import java.util.*;
import org.apache.ibatis.annotations.*;

@Mapper
public interface CoreMapper {
  List<Product> products(
      @Param("q") String q, @Param("offset") long offset, @Param("size") int size);

  long productCount(@Param("q") String q);

  @Select("SELECT * FROM coreerp.products WHERE id=#{id}")
  Product product(long id);

  @Select(
      value =
          "INSERT INTO coreerp.products(sku,name,price,safety_stock)"
              + " VALUES(#{sku},#{name},#{price},#{safetyStock}) RETURNING id",
      affectData = true)
  long createProduct(ProductInput p);

  @Update(
      "UPDATE coreerp.products SET"
          + " sku=#{p.sku},name=#{p.name},price=#{p.price},safety_stock=#{p.safetyStock} WHERE"
          + " id=#{id}")
  void updateProduct(@Param("id") long id, @Param("p") ProductInput p);

  @Update("UPDATE coreerp.products SET active=false WHERE id=#{id}")
  void disableProduct(long id);

  // The table argument comes only from MasterService.Kind, never from user-provided SQL
  // identifiers.
  @Select(
      "SELECT * FROM coreerp.${table} WHERE (code ILIKE #{q} ESCAPE '!' OR name ILIKE #{q} ESCAPE"
          + " '!') ORDER BY id LIMIT #{size} OFFSET #{offset}")
  List<Master> masters(
      @Param("table") String table,
      @Param("q") String q,
      @Param("offset") long offset,
      @Param("size") int size);

  @Select(
      "SELECT count(*) FROM coreerp.${table} WHERE code ILIKE #{q} ESCAPE '!' OR name ILIKE #{q}"
          + " ESCAPE '!'")
  long masterCount(@Param("table") String table, @Param("q") String q);

  @Select("SELECT * FROM coreerp.${table} WHERE id=#{id}")
  Master master(@Param("table") String table, @Param("id") long id);

  @Select(
      value = "INSERT INTO coreerp.${table}(code,name) VALUES(#{p.code},#{p.name}) RETURNING id",
      affectData = true)
  long createMaster(@Param("table") String table, @Param("p") MasterInput p);

  @Update("UPDATE coreerp.${table} SET code=#{p.code},name=#{p.name} WHERE id=#{id}")
  void updateMaster(@Param("table") String table, @Param("id") long id, @Param("p") MasterInput p);

  @Update("UPDATE coreerp.${table} SET active=false WHERE id=#{id}")
  void disableMaster(@Param("table") String table, @Param("id") long id);

  List<Inventory> inventory(
      @Param("warehouse") Long warehouse,
      @Param("q") String q,
      @Param("low") boolean low,
      @Param("offset") long offset,
      @Param("size") int size);

  long inventoryCount(
      @Param("warehouse") Long warehouse, @Param("q") String q, @Param("low") boolean low);

  @Insert(
      "INSERT INTO coreerp.inventory(warehouse_id,product_id) VALUES(#{warehouse},#{product}) ON"
          + " CONFLICT DO NOTHING")
  void ensureStock(@Param("warehouse") long warehouse, @Param("product") long product);

  @Select(
      "SELECT on_hand,reserved FROM coreerp.inventory WHERE warehouse_id=#{warehouse} AND"
          + " product_id=#{product} FOR UPDATE")
  Stock lockStock(@Param("warehouse") long warehouse, @Param("product") long product);

  @Update(
      "UPDATE coreerp.inventory SET on_hand=on_hand+#{delta},reserved=reserved+#{reserved} WHERE"
          + " warehouse_id=#{warehouse} AND product_id=#{product}")
  void stock(
      @Param("warehouse") long warehouse,
      @Param("product") long product,
      @Param("delta") int delta,
      @Param("reserved") int reserved);

  @Insert(
      "INSERT INTO coreerp.stock_movements(warehouse_id,product_id,delta,kind,reference_id,actor)"
          + " VALUES(#{warehouse},#{product},#{delta},#{kind},#{reference},#{actor})")
  void movement(
      @Param("warehouse") long warehouse,
      @Param("product") long product,
      @Param("delta") int delta,
      @Param("kind") String kind,
      @Param("reference") Long reference,
      @Param("actor") String actor);

  @Select("SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(#{key},0))")
  int requestLock(String key);

  @Select(
      "SELECT fingerprint,result_id FROM coreerp.requests WHERE operation=#{operation} AND"
          + " request_key=#{key}")
  Receipt request(@Param("operation") String operation, @Param("key") UUID key);

  @Insert("INSERT INTO coreerp.requests VALUES(#{operation},#{key},#{hash},#{id})")
  void saveRequest(
      @Param("operation") String operation,
      @Param("key") UUID key,
      @Param("hash") String hash,
      @Param("id") long id);

  @Insert(
      "INSERT INTO coreerp.audit_logs(actor,action,entity_type,entity_id,details)"
          + " VALUES(#{actor},#{action},#{type},#{id},CAST(#{details} AS jsonb))")
  void audit(
      @Param("actor") String actor,
      @Param("action") String action,
      @Param("type") String type,
      @Param("id") Long id,
      @Param("details") String details);

  @Select(
      value =
          "INSERT INTO coreerp.purchase_orders(supplier_id,warehouse_id,status,actor)"
              + " VALUES(#{supplier},#{warehouse},'DRAFT',#{actor}) RETURNING id",
      affectData = true)
  long createPurchase(
      @Param("supplier") long supplier,
      @Param("warehouse") long warehouse,
      @Param("actor") String actor);

  @Insert(
      "INSERT INTO coreerp.purchase_order_items(order_id,product_id,quantity,unit_price)"
          + " VALUES(#{order},#{product},#{quantity},#{price})")
  void buyItem(
      @Param("order") long order,
      @Param("product") long product,
      @Param("quantity") int quantity,
      @Param("price") long price);

  Document purchase(long id);

  Document lockPurchase(long id);

  List<Document> purchases(
      @Param("offset") long offset, @Param("size") int size, @Param("status") String status);

  @Select("SELECT count(*) FROM coreerp.purchase_orders WHERE #{status}='' OR status=#{status}")
  long purchaseCount(String status);

  @Select(
      "SELECT i.product_id,p.sku,p.name,i.quantity,i.received processed,i.unit_price FROM"
          + " coreerp.purchase_order_items i JOIN coreerp.products p ON p.id=i.product_id WHERE"
          + " order_id=#{id} ORDER BY product_id")
  List<Item> purchaseItems(long id);

  @Update("UPDATE coreerp.purchase_orders SET status=#{status} WHERE id=#{id}")
  void purchaseStatus(@Param("id") long id, @Param("status") String status);

  @Select(
      value =
          "INSERT INTO coreerp.goods_receipts(purchase_order_id,actor) VALUES(#{order},#{actor})"
              + " RETURNING id",
      affectData = true)
  long receipt(@Param("order") long order, @Param("actor") String actor);

  @Insert("INSERT INTO coreerp.goods_receipt_items VALUES(#{receipt},#{product},#{quantity})")
  void receiptItem(
      @Param("receipt") long receipt,
      @Param("product") long product,
      @Param("quantity") int quantity);

  @Update(
      "UPDATE coreerp.purchase_order_items SET received=received+#{quantity} WHERE"
          + " order_id=#{order} AND product_id=#{product}")
  void received(
      @Param("order") long order, @Param("product") long product, @Param("quantity") int quantity);

  @Select(
      value =
          "INSERT INTO coreerp.sales_orders(customer_id,warehouse_id,status,actor)"
              + " VALUES(#{customer},#{warehouse},'RESERVED',#{actor}) RETURNING id",
      affectData = true)
  long createSale(
      @Param("customer") long customer,
      @Param("warehouse") long warehouse,
      @Param("actor") String actor);

  @Insert("INSERT INTO coreerp.sales_order_items VALUES(#{order},#{product},#{quantity},#{price})")
  void saleItem(
      @Param("order") long order,
      @Param("product") long product,
      @Param("quantity") int quantity,
      @Param("price") long price);

  Document sale(long id);

  Document lockSale(long id);

  List<Document> sales(
      @Param("offset") long offset, @Param("size") int size, @Param("status") String status);

  @Select("SELECT count(*) FROM coreerp.sales_orders WHERE #{status}='' OR status=#{status}")
  long salesCount(String status);

  @Select(
      "SELECT i.product_id,p.sku,p.name,i.quantity,0 processed,i.unit_price FROM"
          + " coreerp.sales_order_items i JOIN coreerp.products p ON p.id=i.product_id WHERE"
          + " order_id=#{id} ORDER BY product_id")
  List<Item> saleItems(long id);

  @Update("UPDATE coreerp.sales_orders SET status=#{status} WHERE id=#{id}")
  void saleStatus(@Param("id") long id, @Param("status") String status);

  @Select(
      value =
          "INSERT INTO coreerp.shipments(sales_order_id,status,actor)"
              + " VALUES(#{order},'CONFIRMED',#{actor}) RETURNING id",
      affectData = true)
  long shipment(@Param("order") long order, @Param("actor") String actor);

  @Select("SELECT id FROM coreerp.shipments WHERE sales_order_id=#{id}")
  Long shipmentId(long id);

  @Insert("INSERT INTO coreerp.shipment_items VALUES(#{shipment},#{product},#{quantity})")
  void shipmentItem(
      @Param("shipment") long shipment,
      @Param("product") long product,
      @Param("quantity") int quantity);

  @Update(
      "UPDATE coreerp.shipments SET status='CANCELLED',cancelled_at=now() WHERE"
          + " sales_order_id=#{id}")
  void cancelShipment(long id);

  @Select("SELECT * FROM coreerp.users WHERE username=#{username}")
  Account account(String username);

  @Select(
      "SELECT r.role_code FROM coreerp.user_roles r JOIN coreerp.users u ON u.id=r.user_id WHERE"
          + " u.username=#{username} ORDER BY r.role_code")
  List<String> roles(String username);

  @Select("SELECT * FROM coreerp.users ORDER BY id")
  List<Account> accounts();

  @Select(
      value =
          "INSERT INTO coreerp.users(username,password) VALUES(#{username},#{password}) RETURNING"
              + " id",
      affectData = true)
  long createUser(@Param("username") String username, @Param("password") String password);

  @Insert("INSERT INTO coreerp.user_roles VALUES(#{id},#{role})")
  void userRole(@Param("id") long id, @Param("role") String role);

  @Update("UPDATE coreerp.users SET status=#{status} WHERE id=#{id}")
  void userStatus(@Param("id") long id, @Param("status") String status);

  @Update("UPDATE coreerp.users SET last_login_at=now() WHERE username=#{name}")
  void loginAt(String name);

  @Select("SELECT * FROM coreerp.users WHERE id=#{id} FOR UPDATE")
  Account lockUser(long id);

  @Select("SELECT 1 FROM pg_advisory_xact_lock(100,1)")
  int userAdminLock();

  @Select(
      "SELECT count(*) FROM coreerp.users u JOIN coreerp.user_roles r ON r.user_id=u.id WHERE"
          + " r.role_code='ADMIN' AND u.status='ACTIVE'")
  int activeAdmins();

  @Select(
      "SELECT a.id,a.actor,a.action,a.entity_type,a.entity_id,a.details::text,a.created_at FROM"
          + " coreerp.audit_logs a ORDER BY id DESC LIMIT #{size} OFFSET #{offset}")
  List<Audit> audits(@Param("offset") long offset, @Param("size") int size);

  @Select("SELECT count(*) FROM coreerp.audit_logs")
  long auditCount();

  @Select(
      "SELECT m.id,w.name warehouse_name,p.name"
          + " product_name,m.delta,m.kind,m.reference_id,m.actor,m.created_at FROM"
          + " coreerp.stock_movements m JOIN coreerp.warehouses w ON w.id=m.warehouse_id JOIN"
          + " coreerp.products p ON p.id=m.product_id ORDER BY id DESC LIMIT #{size} OFFSET"
          + " #{offset}")
  List<Movement> movements(@Param("offset") long offset, @Param("size") int size);

  @Select("SELECT count(*) FROM coreerp.stock_movements")
  long movementCount();

  @Select(
      "SELECT (SELECT count(*) FROM coreerp.products WHERE active) AS products,(SELECT count(*)"
          + " FROM coreerp.inventory i JOIN coreerp.products p ON p.id=i.product_id WHERE"
          + " i.on_hand-i.reserved<p.safety_stock) AS \"lowStock\",(SELECT"
          + " coalesce(sum(reserved),0) FROM coreerp.inventory) AS reserved")
  Map<String, Object> overview();

  List<SalesDay> salesByPeriod(
      @Param("from") OffsetDateTime from,
      @Param("to") OffsetDateTime to,
      @Param("unit") String unit);

  List<ProductSales> productSales(
      @Param("from") OffsetDateTime from, @Param("to") OffsetDateTime to);

  List<CustomerSales> customerSales(
      @Param("from") OffsetDateTime from, @Param("to") OffsetDateTime to);

  List<FlowStats> flowStats(@Param("from") OffsetDateTime from, @Param("to") OffsetDateTime to);
}
