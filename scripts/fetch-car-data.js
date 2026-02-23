// Updated script to fetch car data without Puppeteer

// Function to fetch data from the API
async function fetchCarData() {
    try {
        const response = await fetch('https://api.example.com/cars'); // Replace with actual API
        if (!response.ok) {
            throw new Error('Network response was not ok ' + response.statusText);
        }
        const data = await response.json();
        console.log('Car Data:', data);
        return data;
    } catch (error) {
        console.error('There was a problem with the fetch operation:', error);
        console.log('If you are unable to fetch data, please enter car details manually:');
        console.log('1. Make: 
2. Model: 
3. Year: 
4. Price: ');
    }
}

// Call the function to fetch car data
fetchCarData();
