-- ORBIT Platform relational schema
-- Additive to the legacy JSON state. It is safe to introduce before runtime data migration.

CREATE TABLE IF NOT EXISTS orbit_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, username VARCHAR(32) NOT NULL UNIQUE, display_name VARCHAR(80) NOT NULL,
 email VARCHAR(320) UNIQUE, password_hash TEXT, bio TEXT NOT NULL DEFAULT '', avatar_url TEXT, banner_url TEXT,
 status VARCHAR(24) NOT NULL DEFAULT 'offline', custom_status VARCHAR(120),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 suspended_at TIMESTAMPTZ, deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_display_name ON users(display_name);
CREATE TABLE IF NOT EXISTS sessions (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token_hash TEXT NOT NULL UNIQUE, expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_active ON sessions(user_id,revoked_at,expires_at);
CREATE TABLE IF NOT EXISTS accounts (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 provider VARCHAR(40) NOT NULL, provider_account_id TEXT NOT NULL,
 access_token_encrypted TEXT, refresh_token_encrypted TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(provider,provider_account_id)
);
CREATE TABLE IF NOT EXISTS devices (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 fingerprint_hash TEXT, name VARCHAR(120), platform VARCHAR(40), last_ip INET,
 last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id,last_seen_at DESC);
CREATE TABLE IF NOT EXISTS two_factor_auth (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, secret_encrypted TEXT,
 enabled BOOLEAN NOT NULL DEFAULT FALSE, enabled_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS recovery_codes (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 code_hash TEXT NOT NULL UNIQUE, used_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS privacy_settings (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 profile_visibility VARCHAR(20) NOT NULL DEFAULT 'public', dm_policy VARCHAR(24) NOT NULL DEFAULT 'community',
 friend_request_policy VARCHAR(24) NOT NULL DEFAULT 'everyone', activity_visibility VARCHAR(24) NOT NULL DEFAULT 'friends',
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS notification_preferences (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 mentions BOOLEAN NOT NULL DEFAULT TRUE, direct_messages BOOLEAN NOT NULL DEFAULT TRUE,
 friend_requests BOOLEAN NOT NULL DEFAULT TRUE, events BOOLEAN NOT NULL DEFAULT TRUE,
 streams BOOLEAN NOT NULL DEFAULT TRUE, security BOOLEAN NOT NULL DEFAULT TRUE,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS user_settings (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, locale VARCHAR(16) NOT NULL DEFAULT 'en',
 timezone VARCHAR(64), theme JSONB NOT NULL DEFAULT '{}'::jsonb,
 accessibility JSONB NOT NULL DEFAULT '{}'::jsonb, voice_video JSONB NOT NULL DEFAULT '{}'::jsonb,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS communities (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), name VARCHAR(80) NOT NULL,
 slug VARCHAR(120) NOT NULL UNIQUE, type VARCHAR(24) NOT NULL DEFAULT 'public',
 description TEXT NOT NULL DEFAULT '', icon_url TEXT, banner_url TEXT,
 discoverable BOOLEAN NOT NULL DEFAULT TRUE, verified BOOLEAN NOT NULL DEFAULT FALSE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_communities_discover ON communities(discoverable,verified,created_at DESC);
CREATE TABLE IF NOT EXISTS community_members (
 community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 nickname VARCHAR(80), joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), muted_until TIMESTAMPTZ, timeout_until TIMESTAMPTZ,
 PRIMARY KEY(community_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_community_members_user ON community_members(user_id,joined_at DESC);
CREATE TABLE IF NOT EXISTS roles (
 id TEXT PRIMARY KEY, community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
 name VARCHAR(80) NOT NULL, position INTEGER NOT NULL DEFAULT 0, color VARCHAR(16),
 permissions BIGINT NOT NULL DEFAULT 0, managed BOOLEAN NOT NULL DEFAULT FALSE, UNIQUE(community_id,name)
);
CREATE TABLE IF NOT EXISTS member_roles (
 community_id TEXT NOT NULL, user_id TEXT NOT NULL, role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
 PRIMARY KEY(community_id,user_id,role_id),
 FOREIGN KEY(community_id,user_id) REFERENCES community_members(community_id,user_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS categories (
 id TEXT PRIMARY KEY, community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
 name VARCHAR(80) NOT NULL, position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS channels (
 id TEXT PRIMARY KEY, community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
 category_id TEXT REFERENCES categories(id) ON DELETE SET NULL, name VARCHAR(80) NOT NULL, type VARCHAR(24) NOT NULL,
 topic VARCHAR(255), position INTEGER NOT NULL DEFAULT 0, slow_mode_seconds INTEGER NOT NULL DEFAULT 0,
 archived BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_channels_community_position ON channels(community_id,position);
CREATE TABLE IF NOT EXISTS permission_overrides (
 id TEXT PRIMARY KEY, channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
 role_id TEXT REFERENCES roles(id) ON DELETE CASCADE, user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
 allow_bits BIGINT NOT NULL DEFAULT 0, deny_bits BIGINT NOT NULL DEFAULT 0,
 CHECK(role_id IS NOT NULL OR user_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_permission_overrides_channel ON permission_overrides(channel_id);
CREATE TABLE IF NOT EXISTS messages (
 id TEXT PRIMARY KEY, channel_id TEXT REFERENCES channels(id) ON DELETE CASCADE,
 author_id TEXT NOT NULL REFERENCES users(id), content TEXT NOT NULL DEFAULT '',
 reply_to_id TEXT REFERENCES messages(id) ON DELETE SET NULL, thread_root_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
 pinned BOOLEAN NOT NULL DEFAULT FALSE, edited_at TIMESTAMPTZ, deleted_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_channel_created ON messages(channel_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_messages_author_created ON messages(author_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_root_id,created_at ASC);
CREATE TABLE IF NOT EXISTS message_reactions (
 message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 emoji VARCHAR(32) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(message_id,user_id,emoji)
);
CREATE TABLE IF NOT EXISTS message_attachments (
 id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
 storage_key TEXT NOT NULL UNIQUE, filename VARCHAR(255) NOT NULL, mime_type VARCHAR(140) NOT NULL,
 size_bytes BIGINT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS message_edits (
 id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
 editor_id TEXT NOT NULL REFERENCES users(id), previous_content TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS bookmarks (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(user_id,message_id)
);
CREATE TABLE IF NOT EXISTS friendships (
 requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 addressee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 status VARCHAR(16) NOT NULL DEFAULT 'pending', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(requester_id,addressee_id), CHECK(requester_id<>addressee_id)
);
CREATE INDEX IF NOT EXISTS idx_friendships_addressee_status ON friendships(addressee_id,status);
CREATE TABLE IF NOT EXISTS blocks (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, blocked_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(user_id,blocked_user_id), CHECK(user_id<>blocked_user_id)
);
CREATE TABLE IF NOT EXISTS conversations (
 id TEXT PRIMARY KEY, kind VARCHAR(16) NOT NULL, created_by TEXT NOT NULL REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS conversation_members (
 conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_read_at TIMESTAMPTZ,
 PRIMARY KEY(conversation_id,user_id)
);
CREATE TABLE IF NOT EXISTS direct_messages (
 id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 author_id TEXT NOT NULL REFERENCES users(id), content TEXT NOT NULL DEFAULT '', reply_to_id TEXT REFERENCES direct_messages(id) ON DELETE SET NULL,
 edited_at TIMESTAMPTZ, deleted_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_direct_messages_conversation_created ON direct_messages(conversation_id,created_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS notifications (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, type VARCHAR(40) NOT NULL,
 title VARCHAR(180) NOT NULL, body TEXT NOT NULL DEFAULT '', payload JSONB NOT NULL DEFAULT '{}'::jsonb,
 read_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read_created ON notifications(user_id,read_at,created_at DESC);
CREATE TABLE IF NOT EXISTS invitations (
 id TEXT PRIMARY KEY, community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE, creator_id TEXT NOT NULL REFERENCES users(id),
 code VARCHAR(80) NOT NULL UNIQUE, max_uses INTEGER, use_count INTEGER NOT NULL DEFAULT 0, expires_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS bans (
 id TEXT PRIMARY KEY, community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id),
 moderator_id TEXT NOT NULL REFERENCES users(id), reason TEXT, expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS reports (
 id TEXT PRIMARY KEY, reporter_id TEXT NOT NULL REFERENCES users(id), community_id TEXT REFERENCES communities(id) ON DELETE SET NULL,
 target_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
 reason TEXT NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'open', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_reports_status_created ON reports(status,created_at DESC);
CREATE TABLE IF NOT EXISTS moderation_actions (
 id TEXT PRIMARY KEY, community_id TEXT REFERENCES communities(id) ON DELETE SET NULL,
 moderator_id TEXT NOT NULL REFERENCES users(id), target_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
 action VARCHAR(24) NOT NULL, reason TEXT, metadata JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS audit_logs (
 id TEXT PRIMARY KEY, actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, action VARCHAR(80) NOT NULL,
 target_type VARCHAR(40), target_id TEXT, metadata JSONB NOT NULL DEFAULT '{}'::jsonb, request_id TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE TABLE IF NOT EXISTS voice_rooms (
 id TEXT PRIMARY KEY, channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE, max_participants INTEGER,
 locked BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS voice_participants (
 voice_room_id TEXT NOT NULL REFERENCES voice_rooms(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), left_at TIMESTAMPTZ, PRIMARY KEY(voice_room_id,user_id,joined_at)
);
CREATE TABLE IF NOT EXISTS calls (
 id TEXT PRIMARY KEY, scope VARCHAR(16) NOT NULL, conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
 channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL, started_by TEXT NOT NULL REFERENCES users(id), mode VARCHAR(16) NOT NULL,
 started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), ended_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_calls_started ON calls(started_at DESC);
CREATE TABLE IF NOT EXISTS streams (
 id TEXT PRIMARY KEY, community_id TEXT REFERENCES communities(id) ON DELETE SET NULL, channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL,
 creator_id TEXT NOT NULL REFERENCES users(id), title VARCHAR(180) NOT NULL, category VARCHAR(80),
 audience VARCHAR(24) NOT NULL DEFAULT 'community', status VARCHAR(16) NOT NULL DEFAULT 'live',
 viewer_count INTEGER NOT NULL DEFAULT 0, started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), ended_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_streams_status_started ON streams(status,started_at DESC);
CREATE TABLE IF NOT EXISTS events (
 id TEXT PRIMARY KEY, community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE, creator_id TEXT NOT NULL REFERENCES users(id),
 title VARCHAR(180) NOT NULL, description TEXT NOT NULL DEFAULT '', starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ,
 timezone VARCHAR(64), location_type VARCHAR(24), channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL, capacity INTEGER,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS event_participants (
 event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 response VARCHAR(16) NOT NULL DEFAULT 'going', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(event_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_events_community_start ON events(community_id,starts_at);
CREATE TABLE IF NOT EXISTS posts (
 id TEXT PRIMARY KEY, community_id TEXT REFERENCES communities(id) ON DELETE CASCADE, author_id TEXT NOT NULL REFERENCES users(id),
 title VARCHAR(180), body TEXT NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'published',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS comments (
 id TEXT PRIMARY KEY, post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE, author_id TEXT NOT NULL REFERENCES users(id),
 body TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS post_reactions (
 post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 emoji VARCHAR(32) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(post_id,user_id,emoji)
);
CREATE TABLE IF NOT EXISTS uploads (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), storage_key TEXT NOT NULL UNIQUE,
 filename VARCHAR(255) NOT NULL, mime_type VARCHAR(140) NOT NULL, size_bytes BIGINT NOT NULL,
 visibility VARCHAR(16) NOT NULL DEFAULT 'private', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_uploads_owner_created ON uploads(owner_id,created_at DESC);
CREATE TABLE IF NOT EXISTS game_activities (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, game_name VARCHAR(140) NOT NULL,
 state VARCHAR(255), started_at TIMESTAMPTZ, ended_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS achievements (
 id TEXT PRIMARY KEY, code VARCHAR(80) NOT NULL UNIQUE, name VARCHAR(120) NOT NULL,
 description TEXT NOT NULL DEFAULT '', icon_url TEXT, enabled BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS user_achievements (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, achievement_id TEXT NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
 awarded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(user_id,achievement_id)
);
CREATE TABLE IF NOT EXISTS creator_profiles (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, headline VARCHAR(180), about TEXT,
 verified BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS creator_follows (
 creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(creator_id,follower_id), CHECK(creator_id<>follower_id)
);
CREATE TABLE IF NOT EXISTS bots (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), name VARCHAR(100) NOT NULL,
 description TEXT NOT NULL DEFAULT '', public BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS integrations (
 id TEXT PRIMARY KEY, community_id TEXT REFERENCES communities(id) ON DELETE CASCADE, owner_id TEXT NOT NULL REFERENCES users(id),
 provider VARCHAR(60) NOT NULL, config_encrypted TEXT, enabled BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS webhooks (
 id TEXT PRIMARY KEY, community_id TEXT REFERENCES communities(id) ON DELETE CASCADE, channel_id TEXT REFERENCES channels(id) ON DELETE CASCADE,
 owner_id TEXT NOT NULL REFERENCES users(id), name VARCHAR(100) NOT NULL, secret_hash TEXT NOT NULL,
 enabled BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS api_keys (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name VARCHAR(100) NOT NULL,
 key_hash TEXT NOT NULL UNIQUE, scopes JSONB NOT NULL DEFAULT '[]'::jsonb, last_used_at TIMESTAMPTZ, expires_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS developer_applications (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name VARCHAR(120) NOT NULL,
 description TEXT NOT NULL DEFAULT '', client_id TEXT NOT NULL UNIQUE, client_secret_hash TEXT,
 redirect_uris JSONB NOT NULL DEFAULT '[]'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS subscriptions (
 id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE SET NULL, community_id TEXT REFERENCES communities(id) ON DELETE SET NULL,
 plan VARCHAR(40) NOT NULL, status VARCHAR(24) NOT NULL DEFAULT 'inactive', provider VARCHAR(40),
 external_id TEXT, renews_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS payments (
 id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE SET NULL, subscription_id TEXT REFERENCES subscriptions(id) ON DELETE SET NULL,
 provider VARCHAR(40) NOT NULL, external_id TEXT, amount_minor BIGINT NOT NULL, currency VARCHAR(8) NOT NULL,
 status VARCHAR(24) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS feature_flags (
 key VARCHAR(120) PRIMARY KEY, enabled BOOLEAN NOT NULL DEFAULT FALSE, rollout_percent INTEGER NOT NULL DEFAULT 0,
 config JSONB NOT NULL DEFAULT '{}'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS analytics_events (
 id BIGSERIAL PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE SET NULL, name VARCHAR(120) NOT NULL,
 properties JSONB NOT NULL DEFAULT '{}'::jsonb, occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_analytics_events_name_time ON analytics_events(name,occurred_at DESC);
CREATE TABLE IF NOT EXISTS search_index (
 object_type VARCHAR(40) NOT NULL, object_id TEXT NOT NULL, community_id TEXT, owner_id TEXT,
 title TEXT, body TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(object_type,object_id)
);
CREATE INDEX IF NOT EXISTS idx_search_index_community ON search_index(community_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS automations (
 id TEXT PRIMARY KEY, community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE, creator_id TEXT NOT NULL REFERENCES users(id),
 name VARCHAR(120) NOT NULL, enabled BOOLEAN NOT NULL DEFAULT TRUE, trigger JSONB NOT NULL, actions JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS plugins (
 id TEXT PRIMARY KEY, owner_id TEXT REFERENCES users(id) ON DELETE SET NULL, name VARCHAR(120) NOT NULL,
 version VARCHAR(40) NOT NULL, manifest JSONB NOT NULL, enabled BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS orbit_state (id INTEGER PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
