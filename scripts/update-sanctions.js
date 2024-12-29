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
        let foundAddresses = 0;
        let digitalCurrencyTypes = new Set();

        for (const entry of sdnEntries) {
            processedEntries++;
            
            try {
                // Get IDs (including crypto addresses)
                const ids = entry.idList?.id || [];
                
                // Get entity name
                const entityName = entry.firstName ? 
                    `${entry.firstName} ${entry.lastName || ''}` : 
                    (entry.lastName || 'Unknown Entity');

                // Get program list
                const programs = entry.programList?.program || [];
                const programString = programs.join(', ');

                // Process all digital currency addresses
                for (const id of ids) {
                    if (id?.idType?.includes('Digital Currency')) {
                        digitalCurrencyTypes.add(id.idType);
                        const address = (id.idNumber || '').toLowerCase();
                        if (!address || address.length < 10) continue;

                        foundAddresses++;

                        addresses[address] = {
                            entity: entityName.trim(),
                            program: programString,
                            type: id.idType,
                            uid: entry.uid
                        };
                    }
                }
            } catch (error) {
                console.error(`Error processing entry ${processedEntries}:`, error.message);
            }
        }

        console.log('\nProcessing Summary:');
        console.log(`Total entries processed: ${processedEntries}`);
        console.log(`Total addresses found: ${foundAddresses}`);
        console.log(`Unique addresses: ${Object.keys(addresses).length}`);
        console.log('\nDigital Currency Types found:');
        digitalCurrencyTypes.forEach(type => console.log(`- ${type}`));

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