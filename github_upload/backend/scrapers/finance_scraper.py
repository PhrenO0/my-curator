import yfinance as yf

def get_stock_summary(tickers, period="1d"):
    """
    Fetch basic stock summary for given tickers.
    tickers: list of ticker strings (e.g., ["AAPL", "MSFT", "^KS11"])
    """
    summary = []
    for ticker in tickers:
        try:
            stock = yf.Ticker(ticker)
            # get historical market data
            hist = stock.history(period=period)
            if not hist.empty:
                last_quote = hist.iloc[-1]
                prev_quote = hist.iloc[-2] if len(hist) > 1 else last_quote
                
                current_price = last_quote["Close"]
                prev_close = prev_quote["Close"]
                change_percent = ((current_price - prev_close) / prev_close) * 100
                
                info = stock.info
                name = info.get("shortName", ticker)
                
                summary.append({
                    "ticker": ticker,
                    "name": name,
                    "price": round(current_price, 2),
                    "change_percent": round(change_percent, 2),
                    "currency": info.get("currency", "USD")
                })
        except Exception as e:
            print(f"Error fetching data for {ticker}: {e}")
            
    return summary

if __name__ == "__main__":
    print("Testing Finance Scraper:")
    stocks = get_stock_summary(["^KS11", "^KQ11", "AAPL", "005930.KS"]) # KOSPI, KOSDAQ, Apple, Samsung
    for s in stocks:
        print(f"{s['name']} ({s['ticker']}): {s['price']} {s['currency']} ({s['change_percent']}%)")
