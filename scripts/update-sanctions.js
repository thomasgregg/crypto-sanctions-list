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

        // Count raw instances in XML
        const rawMatches = xmlContent.match(/Digital Currency Address/g) || [];
        console.log(`\nFound ${rawMatches.length} raw Digital Currency Address mentions in XML`);

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
            removeNSPrefix: true,
            isArray: (name) => {
                return ['sdnEntry', 'id', 'program', 'aka'].includes(name);
            }
        });

        console.log('Parsing XML data...');
        const result = parser.parse(xmlContent);
        
        const sdnEntries = result?.sdnList?.sdnEntry || [];
        console.log(`Found ${sdnEntries.length} SDN entries to process...`);

        const addresses = {};
        const missingAddresses = new Set();
        let processedEntries = 0;
        let totalDigitalCurrencyIds = 0;
        let foundAddresses = 0;
        let digitalCurrencyTypes = new Set();

        // Track what we've found by type
        const addressesByType = {};

        for (const entry of sdnEntries) {
            processedEntries++;
            
            try {
                const ids = entry.idList?.id || [];
                const entityName = entry.firstName ? 
                    `${entry.firstName} ${entry.lastName || ''}` : 
                    (entry.lastName || 'Unknown Entity');

                // Count all digital currency IDs
                for (const id of ids) {
                    if (id?.idType?.includes('Digital Currency')) {
                        totalDigitalCurrencyIds++;
                        digitalCurrencyTypes.add(id.idType);

                        // Initialize counter for this type
                        addressesByType[id.idType] = (addressesByType[id.idType] || 0) + 1;

                        const address = (id.idNumber || '').toLowerCase();
                        if (!address || address.length < 10) {
                            console.log(`Warning: Invalid address found for ${entityName}: ${address}`);
                            missingAddresses.add(`${entityName}: ${id.idType} (Invalid address: ${address})`);
                            continue;
                        }

                        foundAddresses++;

                        addresses[address] = {
                            entity: entityName.trim(),
                            program: (entry.programList?.program || []).join(', '),
                            type: id.idType,
                            uid: entry.uid
                        };
                    }
                }
            } catch (error) {
                console.error(`Error processing entry ${processedEntries}:`, error.message);
            }

            if (processedEntries % 1000 === 0) {
                console.log(`Processed ${processedEntries}/${sdnEntries.length} entries...`);
            }
        }

        // Print detailed summary
        console.log('\n=== Processing Summary ===');
        console.log(`Raw "Digital Currency Address" mentions in XML: ${rawMatches.length}`);
        console.log(`Total Digital Currency IDs found: ${totalDigitalCurrencyIds}`);
        console.log(`Valid addresses processed: ${foundAddresses}`);
        console.log(`Unique addresses saved: ${Object.keys(addresses).length}`);

        console.log('\n=== Addresses by Type ===');
        Object.entries(addressesByType).forEach(([type, count]) => {
            console.log(`${type}: ${count}`);
        });

        if (missingAddresses.size > 0) {
            console.log('\n=== Missing/Invalid Addresses ===');
            missingAddresses.forEach(addr => console.log(addr));
        }

        if (totalDigitalCurrencyIds !== rawMatches.length) {
            console.log('\n!!! Warning: Count mismatch !!!');
            console.log(`Raw mentions: ${rawMatches.length}`);
            console.log(`Processed IDs: ${totalDigitalCurrencyIds}`);
        }

        return addresses;

    } catch (error) {
        console.error('Error fetching or parsing SDN list:', error.message);
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
        console.log(`Total addresses saved: ${Object.keys(addresses).length}`);

        return sanctionsData;
    } catch (error) {
        console.error('Error in updateSanctionsList:', error);
        throw error;
    }
}

updateSanctionsList()
    .then(() => {
        console.log('\nUpdate completed successfully');
        process.exit(0);
    })
    .catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });