# Website Monitoring Tool Setup Instructions

## Prerequisites
- Ensure you have administrative access to the server where the website is hosted.
- Install the necessary tools as outlined below:
  - Python 3.7 or higher
  - pip (Python package installer)
  - Git
- Access to your domain and hosting configurations.

## Installation Steps

1. **Clone the Repository**  
   Open your terminal and run:
   ```bash
   git clone https://github.com/pggLLC/Housing-Analytics.git
   cd Housing-Analytics
   ```  

2. **Create a Virtual Environment**  
   Set up a virtual environment for the project:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows use `venv\Scripts\activate`
   ```  

3. **Install Required Packages**  
   Install the website monitoring tool and its dependencies:
   ```bash
   pip install -r requirements.txt
   ```  

4. **Configuration**  
   - Locate the configuration file (e.g., `config.json`) in the project root.
   - Update the settings for your monitoring needs, such as the URLs of the websites to be monitored and notification settings.

5. **Run the Tool**  
   To start the monitoring tool, run:
   ```bash
   python monitor.py
   ```

6. **Set Up a Cron Job (Optional)**  
   For ongoing monitoring, set up a cron job to run the monitoring tool at specified intervals. Open your crontab:
   ```bash
   crontab -e
   ```  
   Add the following line to run every hour:
   ```bash
   0 * * * * /path/to/your/python /path/to/your/monitor.py
   ```

## Important Notes
- Ensure that your server's firewall allows outbound connections for monitoring.
- Regularly check the logs for any errors or monitoring alerts.

## Support
If you encounter any issues, feel free to reach out to the support team or check the documentation for troubleshooting tips.