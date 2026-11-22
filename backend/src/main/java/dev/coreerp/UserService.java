package dev.coreerp;

import static dev.coreerp.Models.*;

import java.util.*;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class UserService {
  private final CoreMapper db;
  private final PasswordEncoder encoder;

  public UserService(CoreMapper db, PasswordEncoder e) {
    this.db = db;
    encoder = e;
  }

  public List<UserView> list() {
    return db.accounts().stream()
        .map(
            u ->
                new UserView(
                    u.id(), u.username(), u.status(), u.lastLoginAt(), db.roles(u.username())))
        .toList();
  }

  @Transactional
  public long create(String actor, UserInput in) {
    if (in.password().getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 72)
      throw new BusinessException(
          org.springframework.http.HttpStatus.BAD_REQUEST,
          "PASSWORD_TOO_LONG",
          "비밀번호는 UTF-8 기준 72바이트 이하여야 합니다.");
    long id = db.createUser(in.username(), encoder.encode(in.password()));
    db.userRole(id, in.role());
    db.audit(actor, "USER_CREATE", "USER", id, "{}");
    return id;
  }

  @Transactional
  public void status(String actor, long id, String status) {
    db.userAdminLock();
    var u = db.lockUser(id);
    if (u == null) throw BusinessException.missing();
    if (status.equals("LOCKED")
        && db.roles(u.username()).contains("ADMIN")
        && db.activeAdmins() <= 1) throw BusinessException.conflict("마지막 활성 관리자는 잠글 수 없습니다.");
    db.userStatus(id, status);
    db.audit(actor, "USER_STATUS", "USER", id, "{}");
  }
}
