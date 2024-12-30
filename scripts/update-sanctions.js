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

        const rawMatches = xmlContent.match(/Digital Currency Address/g) || [];
        console.log(`\nFound ${rawMatches.length} raw Digital Currency Address mentions in XML`);

        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '',
            parseAttributeValue: false,
            allowBooleanAttributes: true,
            textNodeName: 'text',
            ignoreDeclaration: true,
            ignorePiTags: true,
            parseTagValue: false,
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
        let processedEntries = 0;
        let totalDigitalCurrencyIds = 0;
        let foundAddresses = 0;
        let digitalCurrencyTypes = new Set();
        const addressesByType = {};

        // Get SDN list publication date
        let sdnDate = 'Unknown';
        const publishDateMatch = xmlContent.match(/<pubDate>([^<]+)<\/pubDate>/);
        if (publishDateMatch && publishDateMatch[1]) {
            sdnDate = publishDateMatch[1].trim();
        }

        for (const entry of sdnEntries) {
            processedEntries++;
            
            try {
                const ids = entry.idList?.id || [];
                const entityName = entry.firstName ? 
                    `${entry.firstName} ${entry.lastName || ''}` : 
                    (entry.lastName || 'Unknown Entity');

                // Get AKA list if available
                const akas = entry.akaList?.aka || [];
                const akaNames = akas.map(aka => 
                    aka.firstName ? `${aka.firstName} ${aka.lastName || ''}` : aka.lastName
                ).filter(Boolean);

                // Process IDs
                for (const id of ids) {
                    if (!id || !id.idType || typeof id.idType !== 'string') continue;

                    if (id.idType.includes('Digital Currency')) {
                        totalDigitalCurrencyIds++;
                        digitalCurrencyTypes.add(id.idType);
                        addressesByType[id.idType] = (addressesByType[id.idType] || 0) + 1;

                        let address = '';
                        if (typeof id.idNumber === 'string') {
                            address = id.idNumber.toLowerCase();
                        } else if (id.idNumber !== undefined && id.idNumber !== null) {
                            address = String(id.idNumber).toLowerCase();
                        }

                        if (!address || address.length < 10) continue;

                        foundAddresses++;

                        // Create entry object
                        const entryDetails = {
                            entity: entityName.trim(),
                            program: (entry.programList?.program || []).join(', '),
                            type: id.idType,
                            uid: entry.uid
                        };

                        // Add AKAs if available
                        if (akaNames.length > 0) {
                            entryDetails.akas = akaNames;
                        }

                        // Add entry info to address
                        if (!addresses[address]) {
                            addresses[address] = {
                                type: id.idType,
                                entries: []
                            };
                        }
                        addresses[address].entries.push(entryDetails);
                    }
                }
            } catch (error) {
                console.error(`Error processing entry ${processedEntries} (${entry.uid}):`, error.message);
            }

            if (processedEntries % 1000 === 0) {
                console.log(`Processed ${processedEntries}/${sdnEntries.length} entries...`);
            }
        }

        console.log('\n=== Processing Summary ===');
        console.log(`Raw "Digital Currency Address" mentions: ${rawMatches.length}`);
        console.log(`Total Digital Currency IDs found: ${totalDigitalCurrencyIds}`);
        console.log(`Valid addresses processed: ${foundAddresses}`);
        console.log(`Unique addresses saved: ${Object.keys(addresses).length}`);

        // Return both addresses and metadata
        return {
            addresses,
            sdnDate,
            totalEntries: foundAddresses
        };

    } catch (error) {
        console.error('Error fetching or parsing SDN list:', error.message);
        throw error;
    }
}

async function updateSanctionsList() {
    try {
        const { addresses, sdnDate, totalEntries } = await fetchAndParseSDNList();

        const sanctionsData = {
            metadata: {
                lastUpdated: new Date().toISOString(),
                sdnListDate: sdnDate,
                source: 'OFAC SDN List',
                totalAddresses: Object.keys(addresses).length,
                totalEntries: totalEntries,
                url: SDN_LIST_URL
            },
            addresses: addresses
        };

        await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
        await fs.writeFile(OUTPUT_FILE, JSON.stringify(sanctionsData, null, 2));

        console.log('\nSuccessfully updated sanctions list');
        console.log(`Total addresses saved: ${Object.keys(addresses).length}`);
        console.log(`SDN List date: ${sdnDate}`);

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