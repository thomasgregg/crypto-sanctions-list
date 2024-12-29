const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'sanctioned-addresses.json');
const SDN_LIST_URL = 'https://www.treasury.gov/ofac/downloads/sdn.xml';

// Safe access to nested properties
const safeGet = (obj, path) => {
    try {
        return path.split('.').reduce((acc, part) => acc && acc[part], obj);
    } catch (e) {
        return undefined;
    }
};

async function fetchAndParseSDNList() {
    try {
        console.log('Fetching OFAC SDN list...');
        const response = await axios.get(SDN_LIST_URL);
        console.log('Received response, size:', response.data.length);

        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '',
            parseAttributeValue: true,
            allowBooleanAttributes: true,
            textNodeName: 'text',
            preserveOrder: false,
            numberParseOptions: {
                skipLike: /[0-9]+/
            }
        });

        let result;
        try {
            console.log('Parsing XML...');
            result = parser.parse(response.data);
            console.log('XML parsed successfully');
        } catch (parseError) {
            console.error('XML parsing error:', parseError);
            throw parseError;
        }

        if (!result || !result.sdnList || !result.sdnList.sdnEntry) {
            console.error('Unexpected XML structure:', Object.keys(result || {}));
            throw new Error('Invalid XML structure');
        }

        const sdnEntries = Array.isArray(result.sdnList.sdnEntry) 
            ? result.sdnList.sdnEntry 
            : [result.sdnList.sdnEntry];

        console.log(`Processing ${sdnEntries.length} SDN entries...`);

        const addresses = {};
        let currentEntry = 0;

        for (const entry of sdnEntries) {
            currentEntry++;
            try {
                console.log(`Processing entry ${currentEntry}/${sdnEntries.length}`);
                
                // Safely get IDs
                const idList = safeGet(entry, 'idList.id');
                if (!idList) continue;

                const ids = Array.isArray(idList) ? idList : [idList];
                console.log(`Entry ${currentEntry}: Found ${ids.length} IDs`);

                for (const id of ids) {
                    try {
                        const idType = safeGet(id, 'idType');
                        console.log(`Processing ID type: ${idType}`);

                        if (idType && typeof idType === 'string' &&
                            idType.toLowerCase().includes('digital currency')) {
                            
                            // Get address value safely
                            const address = (safeGet(id, 'text') || safeGet(id, 'idNumber') || '').toLowerCase();
                            if (!address) {
                                console.log('No address found for digital currency ID');
                                continue;
                            }

                            // Get entity details safely
                            const entityName = safeGet(entry, 'lastName') || 
                                            safeGet(entry, 'firstName') || 
                                            'Unknown Entity';

                            const programs = safeGet(entry, 'programList.program');
                            const programString = Array.isArray(programs)
                                ? programs.join(', ')
                                : (typeof programs === 'string' ? programs : 'Not specified');

                            console.log(`Found crypto address: ${address} for ${entityName}`);

                            addresses[address] = {
                                entity: entityName,
                                program: programString,
                                date: safeGet(entry, 'publishInformation.publishDate') || 'Date not specified',
                                reason: safeGet(entry, 'remarks') || 'Listed on OFAC SDN List',
                                type: idType
                            };
                        }
                    } catch (idError) {
                        console.error(`Error processing ID in entry ${currentEntry}:`, idError);
                    }
                }
            } catch (entryError) {
                console.error(`Error processing entry ${currentEntry}:`, entryError);
            }
        }

        console.log(`Found ${Object.keys(addresses).length} cryptocurrency addresses`);
        return addresses;

    } catch (error) {
        console.error('Fatal error in fetchAndParseSDNList:', error);
        throw error;
    }
}

async function updateSanctionsList() {
    try {
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

        await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
        await fs.writeFile(OUTPUT_FILE, JSON.stringify(sanctionsData, null, 2));

        if (Object.keys(addresses).length > 0) {
            console.log('\nFirst few addresses found:');
            Object.entries(addresses).slice(0, 3).forEach(([address, data]) => {
                console.log(`- ${address} (${data.entity})`);
            });
        }

        return sanctionsData;
    } catch (error) {
        console.error('Error in updateSanctionsList:', error);
        throw error;
    }
}

// Run the update with proper error handling
updateSanctionsList()
    .then(() => {
        console.log('Update completed successfully');
        process.exit(0);
    })
    .catch(error => {
        console.error('Update failed:', error);
        process.exit(1);
    });