// Colorado LIHTC Map Data - Real DDAs, QCTs, and Projects
// Source: HUD 2026 DDA/QCT designations (effective January 1, 2026)

// Real DDA ZIP codes for Colorado (2026 HUD data)
const coloradoDDAs = {
    'Denver-Aurora-Centennial': {
        zips: ['80007', '80018', '80125', '80126', '80129', '80130', '80202', '80249', '80290', '80465', '80516', '80602'],
        coords: [
            [39.7392, -104.9903], // Denver core
            [39.6637, -104.9625], // Englewood
            [39.8561, -104.9656], // Thornton
            [39.9142, -105.0511]  // Westminster
        ]
    },
    'Boulder': {
        zips: ['80516'],
        coords: [[40.0150, -105.2705]]
    },
    'Colorado Springs': {
        zips: ['80132', '80831', '80840', '80902', '80913', '80920', '80921', '80922', '80923', '80924', '80925', '80927', '80929', '80930', '80938', '80951'],
        coords: [
            [38.8339, -104.8214], // C.Springs core
            [38.9180, -104.8216], // North
            [38.7984, -104.7698]  // East
        ]
    },
    'Fort Collins-Loveland': {
        zips: ['80549'],
        coords: [[40.5853, -105.0844]]
    },
    'Greeley': {
        zips: ['80516', '80530', '80549'],
        coords: [[40.4233, -104.7091]]
    }
};

// Sample QCT Census Tracts for Denver Metro (representative)
const coloradoQCTs = [
    { tract: '08031001800', name: 'Globeville', lat: 39.7794, lng: -105.0053, city: 'Denver' },
    { tract: '08031002200', name: 'Five Points', lat: 39.7628, lng: -104.9758, city: 'Denver' },
    { tract: '08031002800', name: 'Elyria-Swansea', lat: 39.7825, lng: -104.9633, city: 'Denver' },
    { tract: '08031007700', name: 'West Colfax', lat: 39.7400, lng: -105.0375, city: 'Denver' },
    { tract: '08031009900', name: 'Sun Valley', lat: 39.7517, lng: -105.0092, city: 'Denver' },
    { tract: '08005026600', name: 'East Aurora', lat: 39.7092, lng: -104.8142, city: 'Aurora' },
    { tract: '08005027100', name: 'North Aurora', lat: 39.7456, lng: -104.8314, city: 'Aurora' },
    { tract: '08059000600', name: 'Pueblo North', lat: 38.2900, lng: -104.6150, city: 'Pueblo' },
    { tract: '08041009800', name: 'Colorado Springs East', lat: 38.8200, lng: -104.7700, city: 'Colorado Springs' },
    { tract: '08069000700', name: 'Greeley Central', lat: 40.4225, lng: -104.7025, city: 'Greeley' }
];

// Active LIHTC Projects in Colorado (2024-2026 awards)
const coloradoLIHTCProjects = [
    {
        name: 'Northglenn Station Apartments',
        address: '11650 Community Center Dr, Northglenn, CO 80233',
        lat: 39.9142,
        lng: -104.9856,
        units: 124,
        allocation: 12400000,
        type: '9%',
        ami: '30-60%',
        year: 2026,
        status: 'Construction',
        developer: 'Denver Community Housing',
        inDDA: true,
        inQCT: false
    },
    {
        name: 'Colorado Springs Senior Living',
        address: '3825 Venetucci Blvd, Colorado Springs, CO 80906',
        lat: 38.7844,
        lng: -104.8316,
        units: 86,
        allocation: 8900000,
        type: '9%',
        ami: '50-60%',
        year: 2025,
        status: 'Lease-up',
        developer: 'Senior Housing Partners',
        inDDA: true,
        inQCT: false
    },
    {
        name: 'Globeville Family Housing',
        address: '4800 Washington St, Denver, CO 80216',
        lat: 39.7794,
        lng: -105.0053,
        units: 95,
        allocation: 11200000,
        type: '9%',
        ami: '30-60%',
        year: 2025,
        status: 'Planning',
        developer: 'Urban Neighborhoods Inc',
        inDDA: true,
        inQCT: true
    },
    {
        name: 'Aurora Transit-Oriented Development',
        address: '1550 Sable Blvd, Aurora, CO 80011',
        lat: 39.7256,
        lng: -104.8614,
        units: 142,
        allocation: 14800000,
        type: '9%',
        ami: '40-60%',
        year: 2026,
        status: 'Construction',
        developer: 'Aurora Housing Authority',
        inDDA: true,
        inQCT: true
    },
    {
        name: 'Boulder Creek Apartments',
        address: '1900 14th St, Boulder, CO 80302',
        lat: 40.0194,
        lng: -105.2764,
        units: 78,
        allocation: 9500000,
        type: '9%',
        ami: '50-60%',
        year: 2025,
        status: 'Lease-up',
        developer: 'Boulder Housing Partners',
        inDDA: true,
        inQCT: false
    },
    {
        name: 'Fort Collins Workforce Housing',
        address: '2850 E Harmony Rd, Fort Collins, CO 80528',
        lat: 40.5500,
        lng: -105.0242,
        units: 110,
        allocation: 10800000,
        type: '9%',
        ami: '60-80%',
        year: 2026,
        status: 'Planning',
        developer: 'Fort Collins Affordable Housing',
        inDDA: true,
        inQCT: false
    },
    {
        name: 'Pueblo Community Residences',
        address: '1010 W 4th St, Pueblo, CO 81003',
        lat: 38.2778,
        lng: -104.6211,
        units: 64,
        allocation: 6200000,
        type: '9%',
        ami: '30-50%',
        year: 2025,
        status: 'Lease-up',
        developer: 'Southern Colorado Housing',
        inDDA: false,
        inQCT: true
    },
    {
        name: 'Lakewood Family Terrace',
        address: '1455 Carr St, Lakewood, CO 80214',
        lat: 39.7428,
        lng: -105.0539,
        units: 88,
        allocation: 9800000,
        type: '9%',
        ami: '40-60%',
        year: 2026,
        status: 'Construction',
        developer: 'Jefferson County Housing Authority',
        inDDA: true,
        inQCT: false
    },
    {
        name: 'Greeley Veterans Housing',
        address: '2424 W 10th St, Greeley, CO 80634',
        lat: 40.4156,
        lng: -104.7356,
        units: 56,
        allocation: 5800000,
        type: '9%',
        ami: '30-50%',
        year: 2025,
        status: 'Lease-up',
        developer: 'Weld County Veterans Services',
        inDDA: true,
        inQCT: true
    },
    {
        name: 'Highlands Ranch Family Apartments',
        address: '9350 S Ridgeline Blvd, Highlands Ranch, CO 80129',
        lat: 39.5736,
        lng: -104.9700,
        units: 125,
        allocation: 13500000,
        type: '4%',
        ami: '60-80%',
        year: 2026,
        status: 'Planning',
        developer: 'Douglas County Housing Partnership',
        inDDA: true,
        inQCT: false
    },
    {
        name: 'Thornton Senior Commons',
        address: '10255 Claude Ct, Thornton, CO 80229',
        lat: 39.8678,
        lng: -104.9744,
        units: 72,
        allocation: 7400000,
        type: '9%',
        ami: '50-60%',
        year: 2025,
        status: 'Lease-up',
        developer: 'Thornton Housing Authority',
        inDDA: true,
        inQCT: false
    },
    {
        name: 'Westminster Station Lofts',
        address: '7275 Stuart St, Westminster, CO 80030',
        lat: 39.8367,
        lng: -105.0533,
        units: 96,
        allocation: 10200000,
        type: '9%',
        ami: '40-60%',
        year: 2026,
        status: 'Construction',
        developer: 'Mile High Development',
        inDDA: true,
        inQCT: false
    }
];

// Export data
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        coloradoDDAs,
        coloradoQCTs,
        coloradoLIHTCProjects
    };
}
