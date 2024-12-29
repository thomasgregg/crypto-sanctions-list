const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'sanctioned-addresses.json');
const SDN_LIST_URL = 'https://www.treasury.gov/ofac/downloads/sdn.xml';

async function fetchAndParseSDNList() {
    try {
        console.log('Fetching OFAC SDN XML...');
        const response = await axios.get(SDN_LIST_URL, {
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            responseType: 'text',
            decompress: true
        });

        const xmlContent = response.data;
        console.log('Received XML data, size:', Buffer.byteLength(xmlContent, 'utf8') / 1024 / 1024, 'MB');

        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '',
            parseAttributeValue: true,
            allowBooleanAttributes: true,
            textNodeName: 'text',
            ignoreDeclaration: true,
            ignorePiTags: true,
            parseTagValue: true,
            trimValues: true,
            processEntities: true,
            removeNSPrefix: true
        });

        console.log('Parsing XML data...');
        const result = parser.parse(xmlContent);
        
        const sdnEntries = result?.sdnList?.sdnEntry || [];
        console.log(`Found ${sdnEntries.length} SDN entries to process...`);

        const addresses = {};
        let processedEntries = 0;
        let foundAddresses = 0;
        let uniqueIdTypes = new Set();

        for (const entry of sdnEntries) {
            processedEntries++;
            if (processedEntries % 1000 === 0) {
                console.log(`Processed ${processedEntries}/${sdnEntries.length} entries...`);
            }

            try {
                // Get all IDs
                const idList = entry.idList?.id;
                if (!idList) continue;

                const ids = Array.isArray(idList) ? idList : [idList];

                for (const id of ids) {
                    // Track all ID types for debugging
                    if (id.idType) {
                        uniqueIdTypes.add(id.idType);
                    }

                    // Check if this is a cryptocurrency address
                    if (id.idType?.toLowerCase().includes('digital currency')) {
                        const address = id.idNumber?.toLowerCase() || '';
                        if (!address) continue;

                        foundAddresses++;

                        // Get program list
                        const programs = entry.programList?.program;
                        const programString = Array.isArray(programs)
                            ? programs.join(', ')
                            : programs || 'Not specified';

                        // Get entity name
                        const entityName = entry.firstName || entry.lastName || 'Unknown Entity';

                        // Get date if available
                        const dateStr = entry.publishInformation?.publishDate || 'Date not specified';

                        console.log(`\nFound crypto address #${foundAddresses}:`);
                        console.log(`Address: ${address}`);
                        console.log(`Entity: ${entityName}`);
                        console.log(`Program: ${programString}`);

                        addresses[address] = {
                            entity: entityName,
                            program: programString,
                            date: dateStr,
                            reason: entry.remarks || 'Listed on OFAC SDN List',
                            type: id.idType
                        };
                    }
                }
            } catch (error) {
                console.error(`Error processing entry ${processedEntries}:`, error.message);
            }
        }

        console.log('\n\nProcessing complete:');
        console.log(`Total entries processed: ${processedEntries}`);
        console.log(`Total addresses found: ${foundAddresses}`);
        console.log('\nAll unique ID types found:');
        uniqueIdTypes.forEach(type => console.log(`- ${type}`));

        return addresses;

    } catch (error) {
        console.error('Error fetching or parsing SDN list:', error.message);
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response headers:', error.response.headers);
        }
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

        console.log('\nSuccessfully updated sanctions list');
        console.log(`Total addresses in output: ${Object.keys(addresses).length}`);

        return sanctionsData;
    } catch (error) {
        console.error('Error in updateSanctionsList:', error);
        throw error;
    }
}

updateSanctionsList()
    .then(() => {
        console.log('Update completed successfully');
        process.exit(0);
    })
    .catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
    