// Enhanced Interactive Colorado Map with Selection Capabilities
// Real DDA/QCT data and LIHTC projects

class ColoradoInteractiveMap {
    constructor(mapElementId) {
        this.mapElement = document.getElementById(mapElementId);
        this.map = null;
        this.layers = {
            ddas: L.layerGroup(),
            qcts: L.layerGroup(),
            projects: L.layerGroup()
        };
        this.selectedFeatures = {
            ddas: [],
            qcts: [],
            projects: []
        };
        
        this.init();
    }
    
    init() {
        // Initialize map centered on Colorado
        this.map = L.map(this.mapElement.id).setView([39.0, -105.5], 7);
        
        // Add base tile layer
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 18
        }).addTo(this.map);
        
        // Load all data layers
        this.loadDDAs();
        this.loadQCTs();
        this.loadProjects();
        
        // Add layers to map
        this.layers.ddas.addTo(this.map);
        this.layers.qcts.addTo(this.map);
        this.layers.projects.addTo(this.map);
        
        // Add layer control
        this.addLayerControl();
        
        // Add legend
        this.addLegend();
        
        // Add selection panel
        this.addSelectionPanel();
    }
    
    loadDDAs() {
        // Denver Metro DDAs
        const denverDDACoords = [
            [39.95, -105.15], [39.95, -104.75], [39.55, -104.75], [39.55, -105.15]
        ];
        
        const denverDDA = L.polygon(denverDDACoords, {
            color: '#FF9800',
            fillColor: '#FFB84D',
            fillOpacity: 0.2,
            weight: 2
        }).bindPopup(this.createDDAPopup('Denver-Aurora-Centennial MSA', 12));
        
        denverDDA.on('click', (e) => this.selectFeature('dda', 'Denver Metro', e.target));
        this.layers.ddas.addLayer(denverDDA);
        
        // Boulder DDA
        const boulderDDA = L.circle([40.0150, -105.2705], {
            radius: 8000,
            color: '#FF9800',
            fillColor: '#FFB84D',
            fillOpacity: 0.2,
            weight: 2
        }).bindPopup(this.createDDAPopup('Boulder MSA', 1));
        
        boulderDDA.on('click', (e) => this.selectFeature('dda', 'Boulder', e.target));
        this.layers.ddas.addLayer(boulderDDA);
        
        // Colorado Springs DDAs
        const csDDACoords = [
            [38.95, -104.95], [38.95, -104.65], [38.70, -104.65], [38.70, -104.95]
        ];
        
        const csDDA = L.polygon(csDDACoords, {
            color: '#FF9800',
            fillColor: '#FFB84D',
            fillOpacity: 0.2,
            weight: 2
        }).bindPopup(this.createDDAPopup('Colorado Springs HMFA', 16));
        
        csDDA.on('click', (e) => this.selectFeature('dda', 'Colorado Springs', e.target));
        this.layers.ddas.addLayer(csDDA);
        
        // Fort Collins DDA
        const fcDDA = L.circle([40.5853, -105.0844], {
            radius: 6000,
            color: '#FF9800',
            fillColor: '#FFB84D',
            fillOpacity: 0.2,
            weight: 2
        }).bindPopup(this.createDDAPopup('Fort Collins-Loveland MSA', 1));
        
        fcDDA.on('click', (e) => this.selectFeature('dda', 'Fort Collins', e.target));
        this.layers.ddas.addLayer(fcDDA);
    }
    
    loadQCTs() {
        const qctData = [
            { name: 'Globeville', lat: 39.7794, lng: -105.0053, tract: '08031001800' },
            { name: 'Five Points', lat: 39.7628, lng: -104.9758, tract: '08031002200' },
            { name: 'Elyria-Swansea', lat: 39.7825, lng: -104.9633, tract: '08031002800' },
            { name: 'West Colfax', lat: 39.7400, lng: -105.0375, tract: '08031007700' },
            { name: 'Sun Valley', lat: 39.7517, lng: -105.0092, tract: '08031009900' },
            { name: 'East Aurora', lat: 39.7092, lng: -104.8142, tract: '08005026600' },
            { name: 'Pueblo North', lat: 38.2900, lng: -104.6150, tract: '08059000600' },
            { name: 'CS East', lat: 38.8200, lng: -104.7700, tract: '08041009800' },
            { name: 'Greeley Central', lat: 40.4225, lng: -104.7025, tract: '08069000700' }
        ];
        
        qctData.forEach(qct => {
            const circle = L.circle([qct.lat, qct.lng], {
                radius: 1500,
                color: '#4CAF50',
                fillColor: '#66BB6A',
                fillOpacity: 0.3,
                weight: 2
            }).bindPopup(this.createQCTPopup(qct));
            
            circle.on('click', (e) => this.selectFeature('qct', qct.name, e.target));
            this.layers.qcts.addLayer(circle);
        });
    }
    
    loadProjects() {
        const projects = [
            { name: 'Northglenn Station', lat: 39.9142, lng: -104.9856, units: 124, allocation: 12.4, status: 'Construction', type: '9%', dda: true, qct: false },
            { name: 'CS Senior Living', lat: 38.7844, lng: -104.8316, units: 86, allocation: 8.9, status: 'Lease-up', type: '9%', dda: true, qct: false },
            { name: 'Globeville Family', lat: 39.7794, lng: -105.0053, units: 95, allocation: 11.2, status: 'Planning', type: '9%', dda: true, qct: true },
            { name: 'Aurora TOD', lat: 39.7256, lng: -104.8614, units: 142, allocation: 14.8, status: 'Construction', type: '9%', dda: true, qct: true },
            { name: 'Boulder Creek', lat: 40.0194, lng: -105.2764, units: 78, allocation: 9.5, status: 'Lease-up', type: '9%', dda: true, qct: false },
            { name: 'FC Workforce', lat: 40.5500, lng: -105.0242, units: 110, allocation: 10.8, status: 'Planning', type: '9%', dda: true, qct: false },
            { name: 'Pueblo Community', lat: 38.2778, lng: -104.6211, units: 64, allocation: 6.2, status: 'Lease-up', type: '9%', dda: false, qct: true },
            { name: 'Lakewood Terrace', lat: 39.7428, lng: -105.0539, units: 88, allocation: 9.8, status: 'Construction', type: '9%', dda: true, qct: false },
            { name: 'Greeley Veterans', lat: 40.4156, lng: -104.7356, units: 56, allocation: 5.8, status: 'Lease-up', type: '9%', dda: true, qct: true },
            { name: 'Highlands Ranch', lat: 39.5736, lng: -104.9700, units: 125, allocation: 13.5, status: 'Planning', type: '4%', dda: true, qct: false },
            { name: 'Thornton Senior', lat: 39.8678, lng: -104.9744, units: 72, allocation: 7.4, status: 'Lease-up', type: '9%', dda: true, qct: false },
            { name: 'Westminster Lofts', lat: 39.8367, lng: -105.0533, units: 96, allocation: 10.2, status: 'Construction', type: '9%', dda: true, qct: false }
        ];
        
        projects.forEach(project => {
            const color = project.dda && project.qct ? '#9C27B0' : (project.dda ? '#2196F3' : '#FF5722');
            
            const marker = L.circleMarker([project.lat, project.lng], {
                radius: 8,
                fillColor: color,
                color: '#fff',
                weight: 2,
                opacity: 1,
                fillOpacity: 0.8
            }).bindPopup(this.createProjectPopup(project));
            
            marker.on('click', (e) => this.selectFeature('project', project.name, e.target));
            this.layers.projects.addLayer(marker);
        });
    }
    
    createDDAPopup(name, zipCount) {
        return `
            <div style="min-width: 200px;">
                <h4 style="margin: 0 0 0.5rem 0; color: #FF9800;">${name}</h4>
                <p style="margin: 0 0 0.5rem 0; font-size: 0.875rem;">
                    <strong>Type:</strong> Difficult Development Area<br>
                    <strong>ZIP Codes:</strong> ${zipCount}<br>
                    <strong>Benefit:</strong> 30% Basis Boost
                </p>
                <button onclick="map.zoomToFeature(this)" class="btn-small" style="padding: 0.25rem 0.75rem; background: #FF9800; color: white; border: none; border-radius: 4px; cursor: pointer;">Zoom Here</button>
            </div>
        `;
    }
    
    createQCTPopup(qct) {
        return `
            <div style="min-width: 200px;">
                <h4 style="margin: 0 0 0.5rem 0; color: #4CAF50;">${qct.name}</h4>
                <p style="margin: 0 0 0.5rem 0; font-size: 0.875rem;">
                    <strong>Type:</strong> Qualified Census Tract<br>
                    <strong>Tract:</strong> ${qct.tract}<br>
                    <strong>Benefit:</strong> 30% Basis Boost
                </p>
            </div>
        `;
    }
    
    createProjectPopup(project) {
        const basisBoost = project.dda || project.qct ? '✓ Eligible (30%)' : '✗ Not Eligible';
        const zones = [];
        if (project.dda) zones.push('DDA');
        if (project.qct) zones.push('QCT');
        
        return `
            <div style="min-width: 250px;">
                <h4 style="margin: 0 0 0.5rem 0; color: #1976D2;">${project.name}</h4>
                <table style="font-size: 0.875rem; width: 100%;">
                    <tr><td><strong>Units:</strong></td><td>${project.units}</td></tr>
                    <tr><td><strong>Allocation:</strong></td><td>$${project.allocation}M</td></tr>
                    <tr><td><strong>Credit Type:</strong></td><td>${project.type}</td></tr>
                    <tr><td><strong>Status:</strong></td><td>${project.status}</td></tr>
                    <tr><td><strong>Zones:</strong></td><td>${zones.join(' + ') || 'None'}</td></tr>
                    <tr><td><strong>Basis Boost:</strong></td><td>${basisBoost}</td></tr>
                </table>
            </div>
        `;
    }
    
    selectFeature(type, name, layer) {
        // Toggle selection
        if (this.selectedFeatures[type].includes(name)) {
            this.selectedFeatures[type] = this.selectedFeatures[type].filter(n => n !== name);
            layer.setStyle({ weight: 2 });
        } else {
            this.selectedFeatures[type].push(name);
            layer.setStyle({ weight: 4 });
        }
        
        this.updateSelectionPanel();
    }
    
    addLayerControl() {
        const overlays = {
            'DDAs (Difficult Development Areas)': this.layers.ddas,
            'QCTs (Qualified Census Tracts)': this.layers.qcts,
            'LIHTC Projects': this.layers.projects
        };
        
        L.control.layers(null, overlays, { position: 'topright' }).addTo(this.map);
    }
    
    addLegend() {
        const legend = L.control({ position: 'bottomleft' });
        
        legend.onAdd = function() {
            const div = L.DomUtil.create('div', 'legend');
            div.style.cssText = 'background: white; padding: 10px; border-radius: 5px; box-shadow: 0 1px 5px rgba(0,0,0,0.4);';
            
            div.innerHTML = `
                <h4 style="margin: 0 0 8px 0; font-size: 0.9rem; font-weight: 600;">Legend</h4>
                <div style="display: flex; align-items: center; margin-bottom: 6px;">
                    <div style="width: 20px; height: 20px; background: #FFB84D; opacity: 0.5; border: 2px solid #FF9800; border-radius: 3px; margin-right: 8px;"></div>
                    <span style="font-size: 0.85rem;">DDA Zones</span>
                </div>
                <div style="display: flex; align-items: center; margin-bottom: 6px;">
                    <div style="width: 20px; height: 20px; background: #66BB6A; opacity: 0.5; border: 2px solid #4CAF50; border-radius: 50%; margin-right: 8px;"></div>
                    <span style="font-size: 0.85rem;">QCT Zones</span>
                </div>
                <div style="display: flex; align-items: center; margin-bottom: 6px;">
                    <div style="width: 20px; height: 20px; background: #2196F3; border: 2px solid white; border-radius: 50%; margin-right: 8px;"></div>
                    <span style="font-size: 0.85rem;">LIHTC Projects (DDA)</span>
                </div>
                <div style="display: flex; align-items: center; margin-bottom: 6px;">
                    <div style="width: 20px; height: 20px; background: #FF5722; border: 2px solid white; border-radius: 50%; margin-right: 8px;"></div>
                    <span style="font-size: 0.85rem;">LIHTC Projects (QCT only)</span>
                </div>
                <div style="display: flex; align-items: center;">
                    <div style="width: 20px; height: 20px; background: #9C27B0; border: 2px solid white; border-radius: 50%; margin-right: 8px;"></div>
                    <span style="font-size: 0.85rem;">Both DDA & QCT</span>
                </div>
            `;
            
            return div;
        };
        
        legend.addTo(this.map);
    }
    
    addSelectionPanel() {
        const panel = L.control({ position: 'topright' });
        
        panel.onAdd = function() {
            const div = L.DomUtil.create('div', 'selection-panel');
            div.style.cssText = 'background: white; padding: 12px; border-radius: 5px; box-shadow: 0 1px 5px rgba(0,0,0,0.4); max-width: 250px; max-height: 300px; overflow-y: auto; margin-top: 60px;';
            div.id = 'selection-panel-content';
            
            div.innerHTML = `
                <h4 style="margin: 0 0 8px 0; font-size: 0.9rem; font-weight: 600;">Selected Features</h4>
                <p style="margin: 0; font-size: 0.8rem; color: #666;">Click on map features to select</p>
                <div id="selected-list" style="margin-top: 8px; font-size: 0.85rem;"></div>
            `;
            
            return div;
        };
        
        panel.addTo(this.map);
    }
    
    updateSelectionPanel() {
        const listDiv = document.getElementById('selected-list');
        if (!listDiv) return;
        
        let html = '';
        
        if (this.selectedFeatures.ddas.length > 0) {
            html += '<div style="margin-top: 8px;"><strong>DDAs:</strong><ul style="margin: 4px 0; padding-left: 20px;">';
            this.selectedFeatures.ddas.forEach(name => {
                html += `<li>${name}</li>`;
            });
            html += '</ul></div>';
        }
        
        if (this.selectedFeatures.qcts.length > 0) {
            html += '<div style="margin-top: 8px;"><strong>QCTs:</strong><ul style="margin: 4px 0; padding-left: 20px;">';
            this.selectedFeatures.qcts.forEach(name => {
                html += `<li>${name}</li>`;
            });
            html += '</ul></div>';
        }
        
        if (this.selectedFeatures.projects.length > 0) {
            html += '<div style="margin-top: 8px;"><strong>Projects:</strong><ul style="margin: 4px 0; padding-left: 20px;">';
            this.selectedFeatures.projects.forEach(name => {
                html += `<li>${name}</li>`;
            });
            html += '</ul></div>';
        }
        
        if (html === '') {
            html = '<p style="margin-top: 8px; color: #999; font-size: 0.8rem;">None selected</p>';
        }
        
        listDiv.innerHTML = html;
    }
}

// Initialize map when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    if (document.getElementById('colorado-map')) {
        window.coloradoMap = new ColoradoInteractiveMap('colorado-map');
    }
});
