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
        
        // Parse XML with detailed options
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '',
            parseAttributeValue: true,
            allowBooleanAttributes: true,
            removeNSPrefix: true,
            textNodeName: "text"
        });

        console.log('Parsing XML data...');
        const result = parser.parse(response.data);
        
        const sdnEntries = result.sdnList?.sdnEntry || [];
        const addresses = {};

        console.log(`Processing ${sdnEntries.length} SDN entries...`);

        let processedAddresses = 0;
        sdnEntries.forEach((entry, index) => {
            try {
                if (entry.idList && entry.idList.id) {
                    const ids = Array.isArray(entry.idList.id) ? entry.idList.id : [entry.idList.id];
                    
                    ids.forEach(id => {
                        // Check if this is a cryptocurrency address
                        if (id.idType && typeof id.idType === 'string' && 
                            (id.idType.includes('Digital Currency Address') || 
                             id.idType.includes('Digital Currency Wallet'))) {
                            
                            const address = id.text?.toLowerCase() || id.idNumber?.toLowerCase();
                            if (!address) {
                                console.log(`Warning: No address found for ID type ${id.idType}`);
                                return;
                            }

                            const entityName = entry.lastName || entry.firstName || 'Unknown Entity';
                            const programs = entry.programList?.program;
                            const programString = Array.isArray(programs) 
                                ? programs.join(', ') 
                                : (typeof programs === 'string' ? programs : 'Not specified');

                            console.log(`Found crypto address: ${address} (${id.idType}) for entity: ${entityName}`);
                            processedAddresses++;

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
            } catch (entryError) {
                console.error(`Error processing entry ${index}:`, entryError.message);
            }
        });

        console.log(`\nProcessed ${processedAddresses} cryptocurrency addresses`);
        return addresses;

    } catch (error) {
        console.error('Error details:', error.message);
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
    .then(() => {
        console.log('\n--- Update completed successfully ---');
        process.exit(0);
    })
    .catch(error => {
        console.error('\n--- Update failed ---');
        console.error('Fatal error:', error);
        process.exit(1);
    });