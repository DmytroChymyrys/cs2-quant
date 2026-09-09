import Decimal from "decimal.js";
// Product arithmetic may multiply 20-digit prices by quantities and sum holdings.
// Clone instead of changing global settings used by the existing collector.
const ExactDecimal = Decimal.clone({ precision: 50 });
export default ExactDecimal;
