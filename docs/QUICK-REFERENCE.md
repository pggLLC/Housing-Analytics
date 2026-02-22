# LIHTC Analytics Hub - Quick Reference
Version: 1.0 - February 14, 2026

## Installation (3 Steps)

### 1. Upload Files
```
js/responsive-nav.js
js/state-allocations-2026.js
js/fred-commodities.js
css/responsive-nav.css
```

### 2. Add to HTML (before </body>)
```html
<link rel="stylesheet" href="css/responsive-nav.css">
<script src="js/responsive-nav.js"></script>
<script src="js/state-allocations-2026.js"></script>
<script src="js/fred-commodities.js"></script>
```

### 3. Configure FRED API Key
```javascript
// In js/fred-commodities.js line 7:
apiKey: 'YOUR_KEY_HERE'
```

Get key at: https://research.stlouisfed.org/useraccount/register

---

## State Allocations API

### Get Statistics
```javascript
const stats = StateAllocations2026.getStats();
// Returns: totalStates, confirmedStates, totalAllocation, avgPerCapita, etc.
```

### Get Specific State
```javascript
const state = StateAllocations2026.getState('CA');
// Returns: { name, allocation, population, perCapita, status, source }
```

### Get Map Color
```javascript
const color = StateAllocations2026.getStateColor(134700000);
// Returns: Hex color based on allocation amount
```

### Access Source Info
```javascript
const source = StateAllocations2026.source;
// Returns: { name, url, lastUpdated, updateFrequency, note }
```

---

## FRED Commodities API

### Get All Commodity Data
```javascript
const data = await FREDCommodities.getAllCommodities();
// Returns: Object with all 18 commodity series
```

### Access Specific Commodity
```javascript
const steel = data.steelMillProducts;
// Returns: { id, name, category, current, date, yoyChange, history }
```

### Calculate Project Impact
```javascript
const impacts = FREDCommodities.calculateProjectImpact(data, 25000000);
// Returns: Array of cost impacts sorted by highest first
```

### Available Commodities (18 total)

**Steel & Metals**: steelMillProducts, steelRebar, copperWireCable, copperBuildingWire, aluminumProducts

**Wood**: softwoodLumber, framingLumber, plywoodSheathing

**Concrete**: concreteProducts, portlandCement, readyMixConcrete

**Other**: gypsumDrywall, asphaltPaving, insulationMaterials

**Energy/Labor**: dieselFuel, naturalGas, constructionWages, constructionMaterialsInput

---

## Map Update Template

```html
<h2>2026 Federal LIHTC Information by State</h2>

<div class="map-source-info">
    <p><strong>Data Source:</strong> 
        <a href="https://www.novoco.com/resource-centers/affordable-housing-tax-credits/2026-federal-lihtc-information-by-state" 
           target="_blank" rel="noopener">
            Novogradac - 2026 Federal LIHTC Information by State
        </a>
    </p>
    <p><small>Last Updated: February 2026 | Update Frequency: Quarterly</small></p>
    <p><small>27 states confirmed, 23 states estimated. Check source for latest updates.</small></p>
</div>
```

---

## Responsive Breakpoints

- **Desktop**: > 768px (horizontal menu, hover dropdowns)
- **Tablet**: 769px - 1024px (compressed menu)
- **Mobile**: < 768px (hamburger menu, tap dropdowns)

---

## Quick Troubleshooting

**Menu not working?**
→ Clear cache, check console errors, verify file loaded

**FRED data not loading?**
→ Check API key, test API directly, check rate limits

**State data wrong?**
→ Verify state abbreviation is uppercase ('CA' not 'ca')

**Map source not showing?**
→ Check CSS loaded, clear cache, inspect element

---

## Top State Allocations

1. California: $134.7M
2. Texas: $106.9M
3. Florida: $79.9M
4. New York: $68.1M
5. Pennsylvania: $44.4M (estimated)

---

## File Sizes

- responsive-nav.js: 2.1 KB
- state-allocations-2026.js: 14.8 KB
- fred-commodities.js: 6.2 KB
- responsive-nav.css: 3.4 KB
**Total: 26.5 KB**

---

## Browser Support

✓ Chrome 90+, Firefox 88+, Safari 14+, Edge 90+, Mobile browsers

---

## Update Schedule

- **State Allocations**: Check Novogradac quarterly
- **FRED Commodities**: Auto-updates monthly
- **Check for Updates**: Visit source URLs

**State Data**: https://www.novoco.com/resource-centers/affordable-housing-tax-credits/2026-federal-lihtc-information-by-state
**FRED Data**: https://fred.stlouisfed.org

---

## Support

- GitHub Issues: Open issue on repository
- Console Errors: Check browser developer tools (F12)
- Documentation: See IMPLEMENTATION-GUIDE.md

---

**End of Quick Reference**
