(function exposeCombatCore(root) {
  const DAMAGE_TYPES = Object.freeze({
    CONTACT: "contact",
    PROJECTILE: "projectile",
    TELEGRAPH: "telegraph",
    POLLUTION: "pollution",
    SACRIFICE: "sacrifice",
  });

  function ensurePlayerState(player) {
    player.states ||= {};
    player.states.bewildered ||= false;
    player.states.canDamage = player.states.canDamage !== false;
    player.states.canPassEnemies ||= false;
    player.states.opacity ??= 1;
    player.waxShield ??= 0;
    player.invuln ??= 0;
    return player.states;
  }

  function tickPlayerState(player, dt) {
    ensurePlayerState(player);
    player.invuln = Math.max(0, player.invuln - dt);
  }

  function setBewildered(player, enabled) {
    const states = ensurePlayerState(player);
    states.bewildered = enabled;
    states.canDamage = !enabled;
    states.canPassEnemies = enabled;
    states.opacity = enabled ? 0.3 : 1;
  }

  function takePlayerDamage(player, amount, type, options = {}) {
    ensurePlayerState(player);
    const damageType = type || DAMAGE_TYPES.CONTACT;
    const incoming = Math.max(0, Number(amount) || 0);
    if (incoming <= 0) return { applied: 0, absorbed: 0, ignored: true, type: damageType };
    // 无敌模式：所有受伤路径（contact/projectile/telegraph/pollution/sacrifice 等）免疫
    if (player.invincible) {
      return { applied: 0, absorbed: 0, ignored: true, type: damageType };
    }
    if (damageType === DAMAGE_TYPES.SACRIFICE) {
      const before = player.hp;
      player.hp = Math.max(options.minHp ?? 1, player.hp - incoming);
      return {
        applied: before - player.hp,
        absorbed: 0,
        ignored: false,
        type: damageType,
      };
    }

    if (player.states.bewildered || player.invuln > 0) {
      return { applied: 0, absorbed: 0, ignored: true, type: damageType };
    }

    let remaining = incoming;
    const absorbed = Math.min(player.waxShield, remaining);
    player.waxShield -= absorbed;
    remaining -= absorbed;
    player.hp -= remaining;
    player.invuln = options.iFrame ?? 0.6;
    return { applied: remaining, absorbed, ignored: false, type: damageType };
  }

  root.DAOGUI_COMBAT_V105 = Object.freeze({
    DAMAGE_TYPES,
    ensurePlayerState,
    tickPlayerState,
    setBewildered,
    takePlayerDamage,
  });
})(window);
