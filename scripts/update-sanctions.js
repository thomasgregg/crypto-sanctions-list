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
        console.log('Response received, length:', response.data.length);

        // Parse XML with detailed options
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '',
            parseAttributeValue: true,
            allowBooleanAttributes: true,
            removeNSPrefix: true
        });

        console.log('Parsing XML data...');
        const result = parser.parse(response.data);
        
        // Debug: Log the structure
        console.log('XML structure:', Object.keys(result));
        console.log('SDN List entries:', result.sdnList?.sdnEntry?.length || 0);

        const sdnEntries = result.sdnList?.sdnEntry || [];
        const addresses = {};

        console.log(`Processing ${sdnEntries.length} SDN entries...`);

        sdnEntries.forEach((entry, index) => {
            if (entry.idList && entry.idList.id) {
                const ids = Array.isArray(entry.idList.id) ? entry.idList.id : [entry.idList.id];
                
                // Debug: Log IDs being processed
                console.log(`Entry ${index + 1}: Processing ${ids.length} IDs`);
                
                ids.forEach(id => {
                    // Debug: Log ID type
                    console.log(`ID type: ${id.idType}`);
                    
                    if (id.idType && id.idType.includes('Digital Currency Address')) {
                        const address = id.idNumber?.toLowerCase();
                        const entityName = entry.lastName || entry.firstName || 'Unknown Entity';
                        const programs = entry.programList?.program;
                        const programString = Array.isArray(programs) 
                            ? programs.join(', ') 
                            : programs || 'Not specified';

                        console.log(`Found crypto address: ${address} for entity: ${entityName}`);

                        addresses[address] = {
                            entity: entityName,
                            program: programString,
                            date: entry.publishInformation?.publishDate || 'Date not specified',
                            reason: entry.remarks || 'Listed on OFAC SDN List',
                            type: id.idType
                        };
                    }
                });
            }
        });

        console.log(`\nTotal addresses found: ${Object.keys(addresses).length}`);
        return addresses;

    } catch (error) {
        console.error('Error details:', {
            message: error.message,
            response: error.response?.status,
            data: error.response?.data?.substring(0, 200) // First 200 chars of error response
        });
        throw error;
    }
}

async function updateSanctionsList() {
    try {
        // Ensure dependencies are installed
        await new Promise((resolve, reject) => {
            require('child_process').exec('npm install axios fast-xml-parser', (error) => {
                if (error) reject(error);
                else resolve();
            });
        });

        console.log('\n--- Starting sanctions data update ---\n');

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

        console.log('\n--- Update Summary ---');
        console.log(`Total addresses found: ${Object.keys(addresses).length}`);
        if (Object.keys(addresses).length > 0) {
            console.log('\nFirst few addresses:');
            Object.entries(addresses).slice(0, 3).forEach(([address, data]) => {
                console.log(`- ${address} (${data.entity})`);
            });
        }

        return sanctionsData;
    } catch (error) {
        console.error('\n--- Error in updateSanctionsList ---');
        console.error('Error:', error);
        throw error;
    }
}

// Run the update
updateSanctionsList()
    .then(() => console.log('\n--- Update completed successfully ---'))
    .catch(error => {
        console.error('\n--- Update failed ---');
        console.error('Fatal error:', error);
        process.exit(1);
    });