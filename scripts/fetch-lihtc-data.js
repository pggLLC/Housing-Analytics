const axios = require('axios');
const fs = require('fs');

const fetchLIHTCData = async () => {
    const url = 'https://hudgis-hud.opendata.arcgis.com/datasets/30dc0e6cadf4484ab66c1de0d885872c_0.geojson';

    try {
        const response = await axios.get(url);
        const lihtcProjects = response.data.features.filter(project => project.properties.PPROJ_ST === 'CO');

        fs.writeFileSync('localLIHTCData.json', JSON.stringify(lihtcProjects, null, 2));
        console.log('LIHTC data for Colorado stored successfully.');
    } catch (error) {
        console.error('Error fetching LIHTC data:', error.message);
    }
};

fetchLIHTCData();