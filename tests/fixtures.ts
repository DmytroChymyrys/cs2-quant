// Names and shape from Skinport's official examples; prices are deterministic test data.
export const name = 'AK-47 | Aquamarine Revenge (Battle-Scarred)';
export const item = { market_hash_name: name, currency: 'USD', suggested_price: 13.18, min_price: 11.33, max_price: 18.22, mean_price: 12.58, median_price: 13.37, quantity: 25, created_at: 1535988253, updated_at: 1568073728, item_page: 'https://skinport.com/item/example', market_page: 'https://skinport.com/market/730' };
const period = { min: 11.33, max: 18.22, avg: 12.58, median: 13.37, volume: 100 };
export const history = { market_hash_name: name, currency: 'USD', item_page: item.item_page, market_page: item.market_page, version: null, last_24_hours: period, last_7_days: period, last_30_days: period, last_90_days: period };
