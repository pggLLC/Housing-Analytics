#!/usr/bin/env python3
"""
Fetch Colorado Association of REALTORS (CAR) market data.
Includes multiple strategies: API, web scraping, Zillow fallback.
"""

import json
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any
import logging

import requests
from bs4 import BeautifulSoup

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent.parent.parent / 'data'
REPORT_FILE = DATA_DIR / 'car-market-report-{}.json'

class CARMarketDataFetcher:
    """Fetch Colorado market data from multiple sources."""
    
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.getenv('CAR_API_KEY')
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Housing-Analytics/1.0'
        })
    
    def fetch_from_car_api(self) -> Optional[Dict[str, Any]]:
        """Fetch from official CAR API (if available)."""
        try:
            if not self.api_key:
                logger.warning('CAR_API_KEY not set; skipping API fetch')
                return None
            
            endpoint = os.getenv('CAR_API_ENDPOINT', 'https://api.car.org/market-data')
            response = self.session.get(
                endpoint,
                headers={'Authorization': f'Bearer {self.api_key}'},
                timeout=10
            )
            response.raise_for_status()
            data = response.json()
            logger.info('Successfully fetched data from CAR API')
            return self._normalize_car_data(data)
        except Exception as e:
            logger.error(f'CAR API fetch failed: {e}')
            return None
    
    def scrape_car_website(self) -> Optional[Dict[str, Any]]:
        """Scrape market data from CAR website as fallback."""
        try:
            url = 'https://www.car.org/marketintelligence/colorado-market-data'
            response = self.session.get(url, timeout=15)
            response.raise_for_status()
            
            soup = BeautifulSoup(response.content, 'html.parser')
            
            # Extract market data from HTML (structure varies; adjust selectors as needed)
            data = {
                'month': datetime.now().strftime('%Y-%m'),
                'source': 'CAR Website Scrape',
                'metrics': {}
            }
            
            # Look for common market metric containers
            metric_selectors = {
                'median_price_sf': ['price', 'median', 'home'],
                'median_rent_2br': ['rent', 'median', 'bedroom'],
                'new_listings': ['new', 'listings'],
                'days_on_market': ['days', 'market'],
                'price_per_sqft': ['price', 'sqft']
            }
            
            for metric, keywords in metric_selectors.items():
                # This is a simplified example; actual scraping depends on HTML structure
                found = False
                for element in soup.find_all(['div', 'span', 'td']):
                    text = element.get_text(strip=True).lower()
                    if all(kw in text for kw in keywords):
                        # Extract numeric value
                        import re
                        numbers = re.findall(r'[\d,]+\.?\d*', text)
                        if numbers:
                            data['metrics'][metric] = float(numbers[-1].replace(',', ''))
                            found = True
                            break
            
            if data['metrics']:
                logger.info(f'Successfully scraped {len(data["metrics"])} metrics from CAR website')
                return data
            else:
                logger.warning('No metrics found on CAR website')
                return None
        except Exception as e:
            logger.error(f'CAR website scrape failed: {e}')
            return None
    
    def fetch_from_zillow(self) -> Optional[Dict[str, Any]]:
        """Fallback: Fetch market data from Zillow if CAR unavailable."""
        try:
            zillow_key = os.getenv('ZILLOW_API_KEY')
            if not zillow_key:
                logger.warning('ZILLOW_API_KEY not set; skipping Zillow fetch')
                return None
            
            # Zillow API endpoint (if publicly available)
            # Note: Zillow's official API has restricted access; this is a placeholder
            endpoint = 'https://api.zillow.com/property/valuations'
            response = self.session.get(
                endpoint,
                params={
                    'zpid': 'colorado',
                    'apiKey': zillow_key
                },
                timeout=10
            )
            response.raise_for_status()
            
            data = response.json()
            logger.info('Successfully fetched data from Zillow')
            return self._normalize_zillow_data(data)
        except Exception as e:
            logger.error(f'Zillow fetch failed: {e}')
            return None
    
    def _normalize_car_data(self, raw_data: Dict) -> Dict[str, Any]:
        """Normalize CAR API response to standard format."""
        return {
            'month': datetime.now().strftime('%Y-%m'),
            'source': 'Colorado Association of REALTORS (CAR)',
            'median_price_sf': raw_data.get('median_sale_price'),
            'median_rent_2br': raw_data.get('median_rent_2br'),
            'new_listings': raw_data.get('new_listings_count'),
            'days_on_market': raw_data.get('avg_days_on_market'),
            'price_per_sqft': raw_data.get('price_per_sqft'),
            'inventory_level': raw_data.get('months_inventory'),
            'sales_volume': raw_data.get('sales_count'),
            'fetched_at': datetime.utcnow().isoformat() + 'Z'
        }
    
    def _normalize_zillow_data(self, raw_data: Dict) -> Dict[str, Any]:
        """Normalize Zillow API response to standard format."""
        return {
            'month': datetime.now().strftime('%Y-%m'),
            'source': 'Zillow (Fallback)',
            'median_price_sf': raw_data.get('median_price'),
            'median_rent_2br': raw_data.get('median_rent'),
            'price_per_sqft': raw_data.get('zestimate') / raw_data.get('sqft', 1),
            'fetched_at': datetime.utcnow().isoformat() + 'Z'
        }
    
    def fetch(self) -> Optional[Dict[str, Any]]:
        """Attempt to fetch data using multiple strategies."""
        # Strategy 1: Official CAR API
        data = self.fetch_from_car_api()
        if data:
            return data
        
        # Strategy 2: Scrape CAR website
        data = self.scrape_car_website()
        if data:
            return data
        
        # Strategy 3: Fallback to Zillow
        data = self.fetch_from_zillow()
        if data:
            return data
        
        logger.error('All market data fetch strategies failed')
        return None


def main():
    """Main entry point."""
    fetcher = CARMarketDataFetcher()
    market_data = fetcher.fetch()
    
    if not market_data:
        logger.error('Failed to fetch market data from any source')
        sys.exit(1)
    
    # Save to timestamped file
    month = market_data['month']
    output_file = REPORT_FILE.format(month)
    output_file.parent.mkdir(parents=True, exist_ok=True)
    
    with open(output_file, 'w') as f:
        json.dump(market_data, f, indent=2)
    
    logger.info(f'Market data saved to {output_file}')
    
    # Update manifest
    manifest_file = DATA_DIR / 'manifest.json'
    if manifest_file.exists():
        with open(manifest_file) as f:
            manifest = json.load(f)
    else:
        manifest = {'data_sources': []}
    
    # Update or add CAR data source entry
    car_source = {
        'name': 'CAR Market Report',
        'source': market_data.get('source'),
        'last_updated': market_data.get('fetched_at'),
        'file': str(output_file.relative_to(DATA_DIR.parent))
    }
    
    # Replace existing CAR entry or add new
    manifest['data_sources'] = [
        s for s in manifest.get('data_sources', [])
        if s.get('name') != 'CAR Market Report'
    ]
    manifest['data_sources'].append(car_source)
    
    with open(manifest_file, 'w') as f:
        json.dump(manifest, f, indent=2)
    
    logger.info('Manifest updated')


if __name__ == '__main__':
    main()