const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'sanctioned-addresses.json');
const SDN_LIST_URL = 'https://www.treasury.gov/ofac/downloads/sanctions/1.0/sdn_advanced.xml';

async function fetchAndParseSDNList() {
    try {
        console.log('Fetching OFAC SDN Advanced XML...');
        const response = await axios.get(SDN_LIST_URL, {
            validateStatus: status => status === 200,
            maxContentLength: 50 * 1024 * 1024, // 50MB max
            timeout: 30000 // 30 seconds timeout
        });

        // Log response size
        const contentLength = parseInt(response.headers['content-length']);
        console.log('Response size:', {
            contentLength: contentLength ? `${Math.round(contentLength/1024)}KB` : 'unknown',
            actualLength: `${Math.round(response.data.length/1024)}KB`
        });

        // Parse XML with specific options for advanced format
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '',
            parseAttributeValue: true,
            allowBooleanAttributes: true,
            textNodeName: 'text'
        });

        console.log('Parsing XML data...');
        const result = parser.parse(response.data);

        if (!result || !result.sdnList || !result.sdnList.sdnEntry) {
            throw new Error('Invalid XML structure in advanced SDN list');
        }

        const sdnEntries = Array.isArray(result.sdnList.sdnEntry) 
            ? result.sdnList.sdnEntry 
            : [result.sdnList.sdnEntry];

        console.log(`Processing ${sdnEntries.length} SDN entries...`);

        const addresses = {};
        let processedEntries = 0;
        let foundAddresses = 0;

        for (const entry of sdnEntries) {
            processedEntries++;
            if (processedEntries % 1000 === 0) {
                console.log(`Processed ${processedEntries}/${sdnEntries.length} entries...`);
            }

            try {
                // Check for ID list
                const idList = entry.idList?.id;
                if (!idList) continue;

                const ids = Array.isArray(idList) ? idList : [idList];

                for (const id of ids) {
                    if (id.idType?.toLowerCase().includes('digital currency')) {
                        const address = (id.text || id.idNumber || '').toLowerCase();
                        if (!address) continue;

                        foundAddresses++;
                        const entityName = entry.lastName || entry.firstName || 'Unknown Entity';
                        const programs = entry.programList?.program;
                        const programString = Array.isArray(programs)
                            ? programs.join(', ')
                            : (typeof programs === 'string' ? programs : 'Not specified');

                        addresses[address] = {
                            entity: entityName,
                            program: programString,
                            date: entry.publishInformation?.publishDate || 'Date not specified',
                            reason: entry.remarks || 'Listed on OFAC SDN List',
                            type: id.idType
                        };

                        console.log(`Found crypto address #${foundAddresses}: ${address} (${entityName})`);
                    }
                }
            } catch (error) {
                console.error(`Error processing entry ${processedEntries}:`, error.message);
            }
        }

        console.log(`\nProcessing complete:`);
        console.log(`Total entries processed: ${processedEntries}`);
        console.log(`Total addresses found: ${foundAddresses}`);

        return addresses;

    } catch (error) {
        console.error('Error fetching or parsing SDN list:', error);
        throw error;
    }
}

async function updateSanctionsList() {
    try {
        const addresses = await fetchAndParseSDNList();

        const sanctionsData = {
            metadata: {
                lastUpdated: new Date().toISOString(),
                source: 'OFAC SDN Advanced List',
                totalAddresses: Object.keys(addresses).length,
                url: SDN_LIST_URL
            },
            addresses: addresses
        };

        // Ensure data directory exists
        await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true });

        // Write to file
        await fs.writeFile(OUTPUT_FILE, JSON.stringify(sanctionsData, null, 2));

        console.log('\nSuccessfully updated sanctions list');
        console.log(`Total addresses in output: ${Object.keys(addresses).length}`);

        return sanctionsData;
    } catch (error) {
        console.error('Error in updateSanctionsList:', error);
        throw error;
    }
}

// Run the update
updateSanctionsList()
    .then(() => process.exit(0))
    .catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });