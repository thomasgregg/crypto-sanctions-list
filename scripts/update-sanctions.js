const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'sanctioned-addresses.json');
const SDN_LIST_URL = 'https://www.treasury.gov/ofac/downloads/sdn.xml';

async function fetchAndParseSDNList() {
    try {
        console.log('Fetching OFAC SDN list...');
        const response = await axios.get(SDN_LIST_URL);
        const $ = cheerio.load(response.data, { xmlMode: true });
        const addresses = {};

        // Process each SDN entry
        $('sdnEntry').each((_, entry) => {
            const $entry = $(entry);
            
            // Get entity details
            const firstName = $entry.find('firstName').text().trim();
            const lastName = $entry.find('lastName').text().trim();
            const entityName = lastName || firstName;
            
            const programs = $entry.find('programList program')
                .map((_, prog) => $(prog).text().trim())
                .get()
                .join(', ');

            const dateAdded = $entry.find('publishInformation publishDate').text().trim();
            
            // Find all digital currency addresses
            $entry.find('id').each((_, id) => {
                const $id = $(id);
                if ($id.attr('idType') === 'Digital Currency Address' || 
                    $id.attr('idType') === 'Digital Currency Address - XBT' || 
                    $id.attr('idType') === 'Digital Currency Address - ETH' ||
                    $id.attr('idType') === 'Digital Currency Address - XMR') {
                    
                    const address = $id.text().trim().toLowerCase();
                    const idType = $id.attr('idType');
                    const remarks = $entry.find('remarks').text().trim();

                    addresses[address] = {
                        entity: entityName,
                        program: programs,
                        date: dateAdded,
                        reason: remarks || 'Listed on OFAC SDN List',
                        type: idType
                    };

                    console.log(`Found sanctioned address: ${address} (${entityName})`);
                }
            });
        });

        return addresses;
    } catch (error) {
        console.error('Error fetching SDN list:', error);
        throw error;
    }
}

async function updateSanctionsList() {
    try {
        console.log('Starting sanctions data update...');

        // Fetch and parse the SDN list
        const addresses = await fetchAndParseSDNList();

        // Create the data structure
        const sanctionsData = {
            metadata: {
                lastUpdated: new Date().toISOString(),
                source: 'OFAC SDN List',
                totalAddresses: Object.keys(addresses).length
            },
            addresses: addresses
        };

        // Ensure data directory exists
        await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true });

        // Write to file
        await fs.writeFile(
            OUTPUT_FILE,
            JSON.stringify(sanctionsData, null, 2)
        );

        console.log(`Successfully updated sanctions list with ${Object.keys(addresses).length} addresses`);
        return sanctionsData;
    } catch (error) {
        console.error('Error updating sanctions list:', error);
        throw error;
    }
}

// Run the update
updateSanctionsList()
    .then(() => console.log('Update completed successfully'))
    .catch(error => {
        console.error('Update failed:', error);
        process.exit(1);
    });