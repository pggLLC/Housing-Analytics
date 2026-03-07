#!/usr/bin/env python3
"""Fix 1: Inject missing metadata for all 39 FRED series in fred-data.json.

Root cause: Every series only has 'name' and 'observations' fields.
            Missing: title, units, frequency, category, seasonal_adjustment.
Impact:     Chart axis labels, tooltips, and legend are all blank.
Solution:   Inject metadata for all 39 FRED series.
"""

import json
import os

DATA_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'fred-data.json')

SERIES_METADATA = {
    'CPIAUCSL': {
        'title': 'Consumer Price Index for All Urban Consumers: All Items',
        'units': 'Index 1982-1984=100',
        'frequency': 'Monthly',
        'category': 'inflation',
        'seasonal_adjustment': 'Seasonally Adjusted',
    },
    'CUUR0000SAH1': {
        'title': 'Consumer Price Index for All Urban Consumers: Shelter',
        'units': 'Index 1982-1984=100',
        'frequency': 'Monthly',
        'category': 'inflation',
        'seasonal_adjustment': 'Not Seasonally Adjusted',
    },
    'UNRATE': {
        'title': 'Unemployment Rate',
        'units': 'Percent',
        'frequency': 'Monthly',
        'category': 'labor',
        'seasonal_adjustment': 'Seasonally Adjusted',
    },
    'PAYEMS': {
        'title': 'Total Nonfarm Payrolls',
        'units': 'Thousands of Persons',
        'frequency': 'Monthly',
        'category': 'labor',
        'seasonal_adjustment': 'Seasonally Adjusted',
    },
    'CIVPART': {
        'title': 'Labor Force Participation Rate',
        'units': 'Percent',
        'frequency': 'Monthly',
        'category': 'labor',
        'seasonal_adjustment': 'Seasonally Adjusted',
    },
    'CES0500000003': {
        'title': 'Average Hourly Earnings of All Employees: Total Private',
        'units': 'Dollars per Hour',
        'frequency': 'Monthly',
        'category': 'labor',
        'seasonal_adjustment': 'Seasonally Adjusted',
    },
    'JTSJOL': {
        'title': 'Job Openings: Total Nonfarm',
        'units': 'Level in Thousands',
        'frequency': 'Monthly',
        'category': 'labor',
        'seasonal_adjustment': 'Seasonally Adjusted',
    },
    'ICSA': {
        'title': 'Initial Claims',
        'units': 'Number',
        'frequency': 'Weekly',
        'category': 'labor',
        'seasonal_adjustment': 'Seasonally Adjusted',
    },
    'DGS10': {
        'title': 'Market Yield on U.S. Treasury Securities at 10-Year Constant Maturity',
        'units': 'Percent per Annum',
        'frequency': 'Daily',
        'category': 'rates',
        'seasonal_adjustment': 'Not Seasonally Adjusted',
    },
    'DGS2': {
        'title': 'Market Yield on U.S. Treasury Securities at 2-Year Constant Maturity',
        'units': 'Percent per Annum',
        'frequency': 'Daily',
        'category': 'rates',
        'seasonal_adjustment': 'Not Seasonally Adjusted',
    },
    'DFF': {
        'title': 'Effective Federal Funds Rate',
        'units': 'Percent per Annum',
        'frequency': 'Daily',
        'category': 'rates',
        'seasonal_adjustment': 'Not Seasonally Adjusted',
    },
    'SOFR': {
        'title': 'Secured Overnight Financing Rate',
        'units': 'Percent per Annum',
        'frequency': 'Daily',
        'category': 'rates',
        'seasonal_adjustment': 'Not Seasonally Adjusted',
    },
    'MORTGAGE30US': {
        'title': '30-Year Fixed Rate Mortgage Average in the United States',
        'units': 'Percent per Annum',
        'frequency': 'Weekly',
        'category': 'rates',
        'seasonal_adjustment': 'Not Seasonally Adjusted',
    },
    'BAA10Y': {
        'title': "Moody's Seasoned Baa Corporate Bond Yield Relative to Yield on 10-Year Treasury Constant Maturity",
        'units': 'Percent per Annum',
        'frequency': 'Daily',
        'category': 'rates',
        'seasonal_adjustment': 'Not Seasonally Adjusted',
    },
    'T10Y2Y': {
        'title': '10-Year Treasury Constant Maturity Minus 2-Year Treasury Constant Maturity',
        'units': 'Percent',
        'frequency': 'Daily',
        'category': 'rates',
        'seasonal_adjustment': 'Not Seasonally Adjusted',
    },
    'HOUST': {
        'title': 'Housing Starts: Total: New Privately Owned Housing Units Started',
        'units': 'Thousands of Units, Annual Rate',
        'frequency': 'Monthly',
        'category': 'construction',
        'seasonal_adjustment': 'Seasonally Adjusted Annual Rate',
    },
    'HOUST5F': {
        'title': 'Housing Starts: 5-Unit Structures or More',
        'units': 'Thousands of Units, Annual Rate',
        'frequency': 'Monthly',
        'category': 'construction',
        'seasonal_adjustment': 'Seasonally Adjusted Annual Rate',
    },
    'PERMIT': {
        'title': 'New Privately-Owned Housing Units Authorized by Building Permits: Total',
        'units': 'Thousands of Units, Annual Rate',
        'frequency': 'Monthly',
        'category': 'construction',
        'seasonal_adjustment': 'Seasonally Adjusted Annual Rate',
    },
    'PERMIT5': {
        'title': 'New Privately-Owned Housing Units Authorized by Building Permits: 5-Unit Structures or More',
        'units': 'Thousands of Units, Annual Rate',
        'frequency': 'Monthly',
        'category': 'construction',
        'seasonal_adjustment': 'Seasonally Adjusted Annual Rate',
    },
    'UNDCONTSA': {
        'title': 'Housing Units Under Construction',
        'units': 'Thousands of Units',
        'frequency': 'Monthly',
        'category': 'construction',
        'seasonal_adjustment': 'Seasonally Adjusted',
    },
    'COMPUTSA': {
        'title': 'New Privately-Owned Housing Units Completed: 5-Unit Structures or More',
        'units': 'Thousands of Units, Annual Rate',
        'frequency': 'Monthly',
        'category': 'construction',
        'seasonal_adjustment': 'Seasonally Adjusted Annual Rate',
    },
    'CSUSHPISA': {
        'title': 'S&P/Case-Shiller U.S. National Home Price Index',
        'units': 'Index Jan 2000=100',
        'frequency': 'Monthly',
        'category': 'home_prices',
        'seasonal_adjustment': 'Seasonally Adjusted',
    },
    'MSPUS': {
        'title': 'Median Sales Price of Houses Sold for the United States',
        'units': 'Dollars',
        'frequency': 'Quarterly',
        'category': 'home_prices',
        'seasonal_adjustment': 'Not Seasonally Adjusted',
    },
    'RHORUSQ156N': {
        'title': 'Homeownership Rate for the United States',
        'units': 'Percent',
        'frequency': 'Quarterly',
        'category': 'home_prices',
        'seasonal_adjustment': 'Not Seasonally Adjusted',
    },
    'RRVRUSQ156N': {
        'title': 'Rental Vacancy Rate for the United States',
        'units': 'Percent',
        'frequency': 'Quarterly',
        'category': 'home_prices',
        'seasonal_adjustment': 'Not Seasonally Adjusted',
    },
    'WPUFD49207': {
        'title': 'PPI: Inputs to Residential Construction, Goods',
        'units': 'Index Dec 1984=100',
        'frequency': 'Monthly',
        'category': 'construction_costs',
        'seasonal_adjustment': 'Not Seasonally Adjusted',
    },
    'WPUFD4': {
        'title': 'PPI: Final Demand Construction',
        'units': 'Index Dec 2009=100',
        'frequency': 'Monthly',
        'category': 'construction_costs',
        'seasonal_adjustment': 'Not Seasonally Adjusted',
    },
    'PCU236115236115': {
        'title': 'PPI: New Multifamily Housing Construction (Except For-Sale Builders)',
        'units': 'Index Dec 2003=100',
        'frequency': 'Monthly',
        'category': 'construction_costs',
        'seasonal_adjustment': 'Not Seasonally Adjusted',
    },
    'ECIALLCIV': {
        'title': 'Employment Cost Index: Total Compensation, All Civilian Workers',
        'units': 'Index Dec 2005=100',
        'frequency': 'Quarterly',
        'category': 'labor',
        'seasonal_adjustment': 'Seasonally Adjusted',
    },
    'CES2000000008': {
        'title': 'Average Hourly Earnings of All Employees: Construction',
        'units': 'Dollars per Hour',
        'frequency': 'Monthly',
        'category': 'construction_costs',
        'seasonal_adjustment': 'Seasonally Adjusted',
    },
    'WPUSI012011': {
        'title': 'PPI: Lumber and Wood Products',
        'units': 'Index 1982=100',
        'frequency': 'Monthly',
        'category': 'construction_costs',
        'seasonal_adjustment': 'Not Seasonally Adjusted',
    },
    'WPU10170503': {
        'title': 'PPI: Steel Mill Products: Hot Rolled Bars, Plates, Structural Shapes',
        'units': 'Index 1982=100',
        'frequency': 'Monthly',
        'category': 'construction_costs',
        'seasonal_adjustment': 'Not Seasonally Adjusted',
    },
    'PCU331111331111': {
        'title': 'PPI: Iron and Steel Mills and Ferroalloy Manufacturing',
        'units': 'Index Dec 2003=100',
        'frequency': 'Monthly',
        'category': 'construction_costs',
        'seasonal_adjustment': 'Not Seasonally Adjusted',
    },
    'PCU3313153313153': {
        'title': 'PPI: Aluminum Sheet, Plate, and Foil Manufacturing',
        'units': 'Index Dec 2003=100',
        'frequency': 'Monthly',
        'category': 'construction_costs',
        'seasonal_adjustment': 'Not Seasonally Adjusted',
    },
    'PCU32731327313': {
        'title': 'PPI: Cement and Concrete Product Manufacturing',
        'units': 'Index Dec 2003=100',
        'frequency': 'Monthly',
        'category': 'construction_costs',
        'seasonal_adjustment': 'Not Seasonally Adjusted',
    },
    'WPU0811': {
        'title': 'PPI: Softwood Lumber',
        'units': 'Index 1982=100',
        'frequency': 'Monthly',
        'category': 'construction_costs',
        'seasonal_adjustment': 'Not Seasonally Adjusted',
    },
    'WPU0812': {
        'title': 'PPI: Plywood',
        'units': 'Index 1982=100',
        'frequency': 'Monthly',
        'category': 'construction_costs',
        'seasonal_adjustment': 'Not Seasonally Adjusted',
    },
    'WPU057303': {
        'title': 'PPI: No. 2 Diesel Fuel',
        'units': 'Index 1982=100',
        'frequency': 'Monthly',
        'category': 'construction_costs',
        'seasonal_adjustment': 'Not Seasonally Adjusted',
    },
    'CES2000000003': {
        'title': 'Average Hourly Earnings of Production and Nonsupervisory Employees: Construction',
        'units': 'Dollars per Hour',
        'frequency': 'Monthly',
        'category': 'construction_costs',
        'seasonal_adjustment': 'Seasonally Adjusted',
    },
}


def fix_fred_metadata(data_file: str = DATA_FILE) -> None:
    with open(data_file) as f:
        data = json.load(f)

    series = data.get('series', {})
    injected = 0
    missing_from_map = []

    for series_id, series_data in series.items():
        meta = SERIES_METADATA.get(series_id)
        if meta:
            for key, value in meta.items():
                series_data[key] = value
            injected += 1
        else:
            missing_from_map.append(series_id)

    if missing_from_map:
        print(f'WARNING: No metadata defined for: {missing_from_map}')

    with open(data_file, 'w') as f:
        json.dump(data, f, indent=2, separators=(',', ': '))
        f.write('\n')

    print(f'fix_fred_metadata: injected metadata for {injected}/{len(series)} series')


if __name__ == '__main__':
    fix_fred_metadata()
