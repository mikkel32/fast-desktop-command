import {sqliteTable,text,integer,index} from 'drizzle-orm/sqlite-core';
export const devices=sqliteTable('devices',{
 id:text('id').primaryKey(),owner:text('owner'),name:text('name').notNull(),tokenHash:text('token_hash').notNull().unique(),
 codeHash:text('code_hash').notNull().unique(),userCode:text('user_code').notNull().unique(),expires:integer('expires').notNull(),
 paired:integer('paired'),seen:integer('seen'),revoked:integer('revoked').notNull().default(0),
});
export const limits=sqliteTable('rate_limits',{key:text('key').primaryKey(),count:integer('count').notNull(),expires:integer('expires').notNull()});
export const clients=sqliteTable('oauth_clients',{id:text('id').primaryKey(),redirects:text('redirects').notNull(),name:text('name').notNull()});
export const consents=sqliteTable('oauth_consents',{id:text('id').primaryKey(),owner:text('owner').notNull(),params:text('params').notNull(),expires:integer('expires').notNull()});
export const codes=sqliteTable('oauth_codes',{hash:text('hash').primaryKey(),owner:text('owner').notNull(),client:text('client').notNull(),redirect:text('redirect').notNull(),challenge:text('challenge').notNull(),resource:text('resource').notNull(),expires:integer('expires').notNull()});
export const tokens=sqliteTable('oauth_tokens',{hash:text('hash').primaryKey(),owner:text('owner').notNull(),client:text('client').notNull(),resource:text('resource').notNull(),kind:text('kind').notNull(),expires:integer('expires').notNull()});
export const sessions=sqliteTable('mcp_sessions',{id:text('id').primaryKey(),owner:text('owner').notNull(),created:integer('created').notNull()});
export const jobs=sqliteTable('jobs',{
 id:text('id').primaryKey(),device:text('device').notNull(),owner:text('owner').notNull(),session:text('session').notNull(),
 dedupe:text('dedupe').notNull().unique(),request:text('request').notNull(),state:text('state').notNull(),lease:text('lease'),
 result:text('result'),created:integer('created').notNull(),expires:integer('expires').notNull(),
},table=>[index('jobs_device_state').on(table.device,table.state),index('jobs_expiry').on(table.expires)]);
