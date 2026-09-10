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
      (select count(*)::int from watchlist_entries where created_at >= ${since}) as "Retained watchlist additions in window",
      (select count(*)::int from alert_rules where created_at >= ${since}) as "Retained alerts created in window"`,
    users: sql`with selected as (
      select u.id as auth_id,a.id as app_id,u.email,u.created_at,u.email_verified,a.role,a.watch_visited_at,
        case when ${pro} then 'Pro' else 'Free' end as plan,coalesce(s.status,'none') as subscription
      from auth_users u left join app_users a on a.auth_user_id=u.id left join billing_subscriptions s on s.user_id=a.id
      where (${search}='' or position(lower(${search}) in lower(u.email))>0 or a.id::text=${search})
      order by u.created_at desc,u.id desc limit 26 offset ${(page - 1) * 25}
    ) select app_id as "Application user ID",email as "Email",coalesce(role,'USER') as "Role",
      created_at as "Signed up (UTC)",email_verified as "Verified",plan as "Plan",subscription as "Subscription",
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
