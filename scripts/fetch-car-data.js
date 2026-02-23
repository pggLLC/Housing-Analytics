const axios = require('axios');
const cheerio = require('cheerio');

const fetchCarData = async () => {
    try {
        // Fetch the HTML from the target URL
        const { data } = await axios.get('https://coloradorealtors.com/market-trends/');

        // Load the HTML into cheerio
        const $ = cheerio.load(data);
        
        // Initialize an object to hold the market data
        const marketData = [];

        // Scrape relevant market data
        $('selector-for-data').each((index, element) => {
            const dataItem = {};
            dataItem.date = new Date(); // or fetch specific date from the page
            dataItem.value = $(element).text(); // modify selector as necessary
            marketData.push(dataItem);
        });

        // Convert to JSON string and structure
        const jsonOutput = JSON.stringify(marketData, null, 2);
        
        // You might want to write this JSON to a file or export as needed
        console.log(jsonOutput);

    } catch (error) {
        console.error('Error fetching data:', error);
    }
};

fetchCarData();