const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'sanctioned-addresses.json');
const SDN_LIST_URL = 'https://www.treasury.gov/ofac/downloads/sdn.xml';

// Helper function to ensure array
function ensureArray(item) {
    if (!item) return [];
    return Array.isArray(item) ? item : [item];
}

// Helper function to get proper date
function extractDate(entry) {
    try {
        if (entry.publishInformation) {
            const pubInfo = ensureArray(entry.publishInformation)[0];
            if (pubInfo && pubInfo.publishDate) {
                return pubInfo.publishDate;
            }
        }
        return 'Date not specified';
    } catch (error) {
        console.error('Error extracting date:', error);
        return 'Date not specified';
    }
}

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
        
        const sdnEntries = ensureArray(result?.sdnList?.sdnEntry);
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
                const ids = ensureArray(entry.idList?.id);
                
                for (const id of ids) {
                    if (id.idType) {
                        uniqueIdTypes.add(id.idType);
                    }

                    // Check if this is a cryptocurrency address
                    if (id.idType?.toLowerCase().includes('digital currency')) {
                        const address = (id.idNumber || '').toLowerCase();
                        if (!address || address.length < 10) continue; // Basic validation

                        foundAddresses++;

                        // Get program list
                        const programs = ensureArray(entry.programList?.program);
                        const programString = programs.join(', ') || 'Not specified';

                        // Get entity name - try different name fields
                        const entityName = entry.firstName || entry.lastName || 
                                        entry.name || entry.title || 'Unknown Entity';

                        // Get date
                        const dateStr = extractDate(entry);

                        console.log(`\nFound crypto address #${foundAddresses}:`);
                        console.log(`Address: ${address}`);
                        console.log(`Entity: ${entityName}`);
                        console.log(`Program: ${programString}`);
                        console.log(`Date: ${dateStr}`);
                        console.log(`Type: ${id.idType}`);

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
                console.error('Entry data:', JSON.stringify(entry).substring(0, 200));
            }
        }

        // Validation check
        console.log('\n\nValidation Summary:');
        console.log(`Total entries processed: ${processedEntries}`);
        console.log(`Total addresses found: ${foundAddresses}`);
        console.log(`Total unique addresses: ${Object.keys(addresses).length}`);
        console.log('\nSample of dates found:');
        Object.entries(addresses).slice(0, 5).forEach(([addr, data]) => {
            console.log(`${addr.substring(0, 20)}... : ${data.date}`);
        });

        if (foundAddresses > Object.keys(addresses).length) {
            console.log('\nNote: Found some duplicate addresses');
        }

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