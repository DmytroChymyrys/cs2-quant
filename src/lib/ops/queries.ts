import { sql, type SQL } from "drizzle-orm";
// No request data is interpolated into SQL identifiers. All filters are parameters.
export function opsQuery(
  section: string,
  days: number,
  search: string,
  page: number,
) {
  const since =
    days === 1
      ? sql`date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'`
      : sql`now() - ${days} * interval '1 day'`;
  const prices = [
    process.env.STRIPE_PRO_MONTHLY_PRICE_ID,
    process.env.STRIPE_PRO_ANNUAL_PRICE_ID,
  ].filter(Boolean);
  const pro = sql`coalesce(s.status in ('active','trialing') and s.price_id in
    (select jsonb_array_elements_text(${JSON.stringify(prices)}::jsonb)) and s.period_end > now(), false)`;
  const queries: Record<string, SQL> = {
    overview: sql`select
      (select count(*)::int from auth_users) as "Registered users",
      (select count(*)::int from auth_users where created_at >= ${since}) as "Signups in window",
      (select count(*)::int from app_users a where a.auth_user_id is not null and exists(select 1 from watchlist_entries w where w.user_id=a.id)) as "Currently activated users",
      (select count(*)::int from auth_users u join app_users a on a.auth_user_id=u.id where u.created_at >= ${since} and exists(select 1 from watchlist_entries w where w.user_id=a.id)) as "Signups in window currently activated",
      (select count(*)::int from app_users where signup_method='EMAIL') as "Signed up with email",
      (select count(*)::int from app_users where signup_method='GOOGLE') as "Signed up with Google",
      (select count(*)::int from app_users where signup_method='STEAM') as "Signed up with Steam",
      -- Legacy rows whose provenance could not be established from evidence.
      (select count(*)::int from app_users where signup_method='UNKNOWN') as "Signup method unknown",
      (select count(*)::int from watchlist_entries where created_at >= ${since}) as "Retained watchlist additions in window",
      (select count(*)::int from alert_rules where created_at >= ${since}) as "Retained alerts created in window"`,
    users: sql`with selected as (
      select u.id as auth_id,a.id as app_id,u.email,u.created_at,u.email_verified,a.role,a.watch_visited_at,
        a.blocked_at,a.deleted_at,a.status_reason,coalesce(a.signup_method,'UNKNOWN') as signup_method,
        case when ${pro} then 'Pro' else 'Free' end as plan,coalesce(s.status,'none') as subscription
      from auth_users u left join app_users a on a.auth_user_id=u.id left join billing_subscriptions s on s.user_id=a.id
      where (${search}='' or position(lower(${search}) in lower(u.email))>0 or a.id::text=${search})
      order by u.created_at desc,u.id desc limit 26 offset ${(page - 1) * 25}
    ) select app_id as "Application user ID",email as "Email",coalesce(role,'USER') as "Role",
      -- Deleted outranks blocked: a closed account that was also blocked reads
      -- as closed, and the block is recoverable from the audit trail.
      case when deleted_at is not null then 'Deleted'
           when blocked_at is not null then 'Blocked'
           else 'Active' end as "Status",
      status_reason as "Status reason",
      created_at as "Signed up (UTC)",
      /*
       * Two different questions, deliberately two columns.
       *
       * "Signed up with" is how the account was created. It is written once and
       * a database trigger refuses to change it, so it keeps meaning the same
       * thing however many identities are connected later.
       *
       * "Auth methods" is how this person can sign in TODAY. It moves every
       * time an identity is linked or unlinked, and counts repeats because one
       * user may hold several identities from the same provider.
       *
       * Collapsing them into one column would make a Google signup who later
       * connected Steam indistinguishable from a Steam signup, and acquisition
       * numbers would drift as people linked accounts.
       */
      signup_method as "Signed up with",
      coalesce((select string_agg(m.label || ' (' || m.n || ')', ', ' order by m.label)
        from (select case provider_id when 'credential' then 'Email'
                                      when 'google' then 'Google'
                                      when 'steam' then 'Steam'
                                      else initcap(provider_id) end as label,
                     count(*)::int as n
              from auth_accounts where user_id=selected.auth_id
              group by provider_id) m),'None') as "Auth methods",
      email_verified as "Verified",plan as "Plan",subscription as "Subscription",
      watch_visited_at as "Watchlist checkpoint (UTC)",
      (select count(*)::int from watchlist_entries w where w.user_id=selected.app_id) as "Watchlist",
      (select count(*)::int from alert_rules r where r.user_id=selected.app_id) as "Alerts"
      from selected order by created_at desc,auth_id desc`,
    product: sql`select
      (select count(*)::int from watchlist_entries) as "Current watchlist entries",
      (select count(distinct user_id)::int from watchlist_entries) as "Users with watchlists",
      (select count(*)::int from portfolio_holdings) as "Current holdings",
      (select count(distinct user_id)::int from portfolio_holdings) as "Users with portfolios",
      (select count(*)::int from saved_screens) as "Current saved screens",
      (select count(*)::int from alert_rules where not paused) as "Unpaused alert rules",
      (select count(*)::int from alert_events where created_at >= ${since}) as "Alert triggers in window",
      (select count(*)::int from alert_events where created_at >= ${since} and email_state='DELIVERY_EXPIRED') as "Expired alert deliveries in window"`,
    billing: sql`select case when ${pro} then 'Pro' else 'Free' end as "Plan",
      coalesce(s.status,'none') as "Subscription status",count(*)::int as "Users",
      count(*) filter(where s.cancel_at_period_end)::int as "Scheduled cancellations"
      from auth_users u left join app_users a on a.auth_user_id=u.id left join billing_subscriptions s on s.user_id=a.id
      group by 1,2 order by 1,2`,
  };
  return queries[section];
}
export const watchedAssetsQuery = sql`select a.market_hash_name as "Asset",count(*)::int as "Watchers"
  from watchlist_entries w join assets a on a.id=w.asset_id group by a.id,a.market_hash_name
  order by count(*) desc,a.market_hash_name limit 20`;
