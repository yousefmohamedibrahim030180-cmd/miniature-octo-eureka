const PERMISSIONS = Object.freeze({
  VIEW_CHANNEL: 1n << 0n,
  SEND_MESSAGES: 1n << 1n,
  MANAGE_MESSAGES: 1n << 2n,
  CREATE_THREADS: 1n << 3n,
  ATTACH_FILES: 1n << 4n,
  ADD_REACTIONS: 1n << 5n,
  MENTION_EVERYONE: 1n << 6n,
  CONNECT_VOICE: 1n << 7n,
  SPEAK: 1n << 8n,
  USE_VIDEO: 1n << 9n,
  STREAM: 1n << 10n,
  MANAGE_CHANNELS: 1n << 11n,
  MANAGE_ROLES: 1n << 12n,
  MANAGE_MEMBERS: 1n << 13n,
  MANAGE_COMMUNITY: 1n << 14n,
  MANAGE_EVENTS: 1n << 15n,
  MANAGE_WEBHOOKS: 1n << 16n,
  MANAGE_BOTS: 1n << 17n,
  VIEW_AUDIT_LOG: 1n << 18n,
  BAN_MEMBERS: 1n << 19n
});

const ROLE_BITS = Object.freeze({
  owner: PERMISSIONS.MANAGE_COMMUNITY |
    PERMISSIONS.MANAGE_CHANNELS |
    PERMISSIONS.MANAGE_ROLES |
    PERMISSIONS.MANAGE_MEMBERS |
    PERMISSIONS.MANAGE_MESSAGES |
    PERMISSIONS.MANAGE_EVENTS |
    PERMISSIONS.MANAGE_WEBHOOKS |
    PERMISSIONS.MANAGE_BOTS |
    PERMISSIONS.VIEW_AUDIT_LOG |
    PERMISSIONS.BAN_MEMBERS |
    PERMISSIONS.SEND_MESSAGES |
    PERMISSIONS.CONNECT_VOICE |
    PERMISSIONS.SPEAK |
    PERMISSIONS.USE_VIDEO |
    PERMISSIONS.STREAM |
    PERMISSIONS.VIEW_CHANNEL |
    PERMISSIONS.ATTACH_FILES |
    PERMISSIONS.CREATE_THREADS |
    PERMISSIONS.ADD_REACTIONS |
    PERMISSIONS.MENTION_EVERYONE,
  admin: PERMISSIONS.MANAGE_CHANNELS |
    PERMISSIONS.MANAGE_ROLES |
    PERMISSIONS.MANAGE_MEMBERS |
    PERMISSIONS.MANAGE_MESSAGES |
    PERMISSIONS.MANAGE_EVENTS |
    PERMISSIONS.MANAGE_WEBHOOKS |
    PERMISSIONS.MANAGE_BOTS |
    PERMISSIONS.VIEW_AUDIT_LOG |
    PERMISSIONS.BAN_MEMBERS |
    PERMISSIONS.SEND_MESSAGES |
    PERMISSIONS.CONNECT_VOICE |
    PERMISSIONS.SPEAK |
    PERMISSIONS.USE_VIDEO |
    PERMISSIONS.STREAM |
    PERMISSIONS.VIEW_CHANNEL |
    PERMISSIONS.ATTACH_FILES |
    PERMISSIONS.CREATE_THREADS |
    PERMISSIONS.ADD_REACTIONS |
    PERMISSIONS.MENTION_EVERYONE,
  moderator: PERMISSIONS.MANAGE_MESSAGES |
    PERMISSIONS.MANAGE_MEMBERS |
    PERMISSIONS.VIEW_AUDIT_LOG |
    PERMISSIONS.SEND_MESSAGES |
    PERMISSIONS.CONNECT_VOICE |
    PERMISSIONS.SPEAK |
    PERMISSIONS.USE_VIDEO |
    PERMISSIONS.STREAM |
    PERMISSIONS.VIEW_CHANNEL |
    PERMISSIONS.ATTACH_FILES |
    PERMISSIONS.CREATE_THREADS |
    PERMISSIONS.ADD_REACTIONS,
  member: PERMISSIONS.SEND_MESSAGES |
    PERMISSIONS.CONNECT_VOICE |
    PERMISSIONS.SPEAK |
    PERMISSIONS.USE_VIDEO |
    PERMISSIONS.STREAM |
    PERMISSIONS.VIEW_CHANNEL |
    PERMISSIONS.ATTACH_FILES |
    PERMISSIONS.CREATE_THREADS |
    PERMISSIONS.ADD_REACTIONS
});

const CHANNEL_TYPES = Object.freeze(["text","voice","video","stage","forum","announcement","media","stream"]);

function rolePermissions(role) {
  return ROLE_BITS[String(role || "member")] || 0n;
}

function hasPermission(role, permission) {
  return (rolePermissions(role) & permission) === permission;
}

function canManage(role) {
  return hasPermission(role, PERMISSIONS.MANAGE_CHANNELS);
}

function canManageMembers(role) {
  return hasPermission(role, PERMISSIONS.MANAGE_MEMBERS);
}

function canModerate(role) {
  return hasPermission(role, PERMISSIONS.MANAGE_MESSAGES);
}

function canManageCommunity(role) {
  return hasPermission(role, PERMISSIONS.MANAGE_COMMUNITY);
}

function canCreateChannel(role) {
  return hasPermission(role, PERMISSIONS.MANAGE_CHANNELS);
}

function channelAllowsText(type) {
  return ["text","forum","announcement","media"].includes(String(type));
}

function channelAllowsRealtime(type) {
  return ["voice","video","stage","stream"].includes(String(type));
}

module.exports = {
  PERMISSIONS,
  ROLE_BITS,
  CHANNEL_TYPES,
  rolePermissions,
  hasPermission,
  canManage,
  canManageMembers,
  canModerate,
  canManageCommunity,
  canCreateChannel,
  channelAllowsText,
  channelAllowsRealtime
};
