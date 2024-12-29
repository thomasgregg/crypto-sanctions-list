const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'sanctioned-addresses.json');
const SDN_LIST_URL = 'https://www.treasury.gov/ofac/downloads/sdn.xml';

async function fetchAndParseSDNList() {
    try {
        console.log('Fetching OFAC SDN list...');
        const response = await axios.get(SDN_LIST_URL);
        
        // Use fast-xml-parser instead of cheerio for better XML handling
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '@_'
        });
        
        const result = parser.parse(response.data);
        const sdnList = result.sdnList.sdnEntry;
        const addresses = {};

        console.log(`Found ${sdnList.length} SDN entries to process`);

        // Process each SDN entry
        sdnList.forEach(entry => {
            // Get entity details
            const entityName = entry.lastName || entry.firstName || 'Unknown Entity';
            const programs = entry.programList?.program;
            const programString = Array.isArray(programs) ? programs.join(', ') : programs;
            
            // Process ID list
            if (entry.idList?.id) {
                const ids = Array.isArray(entry.idList.id) ? entry.idList.id : [entry.idList.id];
                
                ids.forEach(id => {
                    if (id['@_idType']?.includes('Digital Currency Address')) {
                        const address = id.idNumber.toLowerCase();
                        console.log(`Processing address: ${address} for entity: ${entityName}`);
                        
                        addresses[address] = {
                            entity: entityName,
                            program: programString || 'Not specified',
                            date: entry.publishInformation?.publishDate || 'Date not specified',
                            reason: entry.remarks || 'Listed on OFAC SDN List',
                            type: id['@_idType']
                        };
                    }
                });
            }
        });

        console.log(`Total addresses found: ${Object.keys(addresses).length}`);
        return addresses;

    } catch (error) {
        console.error('Error fetching or parsing SDN list:', error);
        throw error;
    }
}

async function updateSanctionsList() {
    try {
        console.log('Starting sanctions data update...');

        // Install fast-xml-parser if not present
        try {
            require('fast-xml-parser');
        } catch (e) {
            console.log('Installing required dependencies...');
            require('child_process').execSync('npm install fast-xml-parser');
        }

        // Fetch and parse the SDN list
        const addresses = await fetchAndParseSDNList();

        // Create the data structure
        const sanctionsData = {
            metadata: {
                lastUpdated: new Date().toISOString(),
                source: 'OFAC SDN List',
                totalAddresses: Object.keys(addresses).length,
                url: SDN_LIST_URL
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
        
        // Log first few addresses as verification
        const addressList = Object.keys(addresses);
        console.log('\nFirst few addresses found:');
        addressList.slice(0, 5).forEach(addr => {
            console.log(`- ${addr} (${addresses[addr].entity})`);
        });

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