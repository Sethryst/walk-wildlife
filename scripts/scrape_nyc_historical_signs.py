import urllib.request
import re
import json
import html
import time

BASE_URL = "https://www.nycgovparks.org"
LISTING_URL_TEMPLATE = "https://www.nycgovparks.org/about/history/historical-signs/listings?Submit=PAGEABLE_NAV&__store_val_one=&__store_val_two=&__store_val_three=&__store_val_four={page}"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

# Known borough coordinate centers / bounds to assign realistic lat/lngs for NYC Parks IDs
# Borough prefixes in NYC Parks IDs: M = Manhattan, B = Brooklyn, Q = Queens, X = Bronx, R = Staten Island
BOROUGH_CENTROIDS = {
    'M': {'lat': 40.7831, 'lng': -73.9712, 'name': 'Manhattan'},
    'B': {'lat': 40.6782, 'lng': -73.9442, 'name': 'Brooklyn'},
    'Q': {'lat': 40.7282, 'lng': -73.7949, 'name': 'Queens'},
    'X': {'lat': 40.8448, 'lng': -73.8648, 'name': 'Bronx'},
    'R': {'lat': 40.5795, 'lng': -74.1502, 'name': 'Staten Island'}
}

def fetch_page(page_num):
    url = LISTING_URL_TEMPLATE.format(page=page_num)
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            content = resp.read().decode('utf-8', errors='ignore')
            return content
    except Exception as e:
        print(f"Error fetching page {page_num}: {e}")
        return None

def parse_page(content):
    items = []
    # Pattern to match table rows containing sign links and descriptions
    # Example: <a href="/parks/Q290/history">"Uncle" Vito F. Maranzano Glendale Playground</a><br/>What was here before?...
    pattern = re.compile(r'<a\s+href="([^"]+)"[^>]*>(.*?)</a>\s*<br/>\s*(.*?)(?=</td>|\n\s*</tr>|\n\s*<!--)', re.DOTALL | re.IGNORECASE)
    
    for match in pattern.finditer(content):
        href = match.group(1).strip()
        title_raw = match.group(2).strip()
        desc_raw = match.group(3).strip()
        
        # Clean HTML tags and entities
        title = html.unescape(re.sub(r'<[^>]+>', '', title_raw)).strip()
        desc = html.unescape(re.sub(r'<[^>]+>', '', desc_raw)).strip()
        desc = re.sub(r'\s+', ' ', desc)
        
        if not title:
            continue
            
        full_link = href if href.startswith("http") else (BASE_URL + href if href.startswith("/") else BASE_URL + "/about/history/historical-signs/" + href)
        
        # Extract Park ID or Borough code if available
        # e.g. /parks/Q290/history -> Q290 (Queens)
        park_code_match = re.search(r'/parks/([A-Z])\d+', href, re.IGNORECASE)
        borough_code = park_code_match.group(1).upper() if park_code_match else 'M'
        
        items.append({
            'title': title,
            'href': href,
            'link': full_link,
            'description': desc,
            'boroughCode': borough_code
        })
    return items

def main():
    all_items = []
    seen_links = set()
    
    # First fetch page 1 to check total pages
    first_page = fetch_page(1)
    if not first_page:
        print("Could not fetch page 1")
        return
        
    # Find max page number in pagination
    page_numbers = [int(p) for p in re.findall(r'__store_val_four=(\d+)', first_page)]
    max_page = max(page_numbers) if page_numbers else 27
    print(f"Found {max_page} pages of historical signs.")
    
    items = parse_page(first_page)
    for item in items:
        if item['link'] not in seen_links:
            seen_links.add(item['link'])
            all_items.append(item)
    print(f"Page 1: extracted {len(items)} signs.")
    
    for page in range(2, max_page + 1):
        time.sleep(0.3)
        content = fetch_page(page)
        if not content:
            continue
        page_items = parse_page(content)
        count = 0
        for item in page_items:
            if item['link'] not in seen_links:
                seen_links.add(item['link'])
                all_items.append(item)
                count += 1
        print(f"Page {page}/{max_page}: extracted {count} new signs.")
        
    print(f"Total unique historical signs collected: {len(all_items)}")

if __name__ == '__main__':
    main()
