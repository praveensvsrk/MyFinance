/**
 * The employer stock this app tracks (E*TRADE statements, Benefit History rows, Finnhub quotes) is
 * not configured: the ticker is read from the imported E*TRADE files and kept in this setting.
 * Until one is imported there is no employer stock, no quote to fetch and nothing to flag.
 */
export const EQUITY_SYMBOL_SETTING = 'equitySymbol';
