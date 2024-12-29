const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'sanctioned-addresses.json');
const SDN_LIST_URL = 'https://www.treasury.gov/ofac/downloads/sdn.xml';

async function findAllCryptoAddresses(xmlContent) {
    // Log first 1000 characters to see what we're dealing with
    console.log('\nFirst 1000 characters of XML:');
    console.log(xmlContent.substring(0, 1000));

    // More flexible pattern to match crypto addresses
    const patterns = [
        /<idType[^>]*>Digital Currency Address[^<]*<\/idType>/g,
        /<id>[^<]*Digital Currency[^<]*<\/id>/g
    ];

    let allMatches = [];
    for (const pattern of patterns) {
        const matches = xmlContent.match(pattern) || [];
        allMatches = [...allMatches, ...matches];
    }

    console.log('\nRegex search results:');
    console.log(`Found ${allMatches.length} potential crypto address entries`);
    if (allMatches.length > 0) {
        console.log('Sample matches:');
        allMatches.slice(0, 5).forEach(match => console.log(match));
    }

    return allMatches.length;
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

        // Direct search for crypto addresses in raw XML
        const rawMatchCount = await findAllCryptoAddresses(xmlContent);

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
                return ['sdnEntry', 'id', 'program', 'publishInformation'].includes(name);
            }
        });

        console.log('Parsing XML data...');
        const result = parser.parse(xmlContent);
        
        const sdnEntries = result?.sdnList?.sdnEntry || [];
        console.log(`Found ${sdnEntries.length} SDN entries to process...`);

        // Log sample entry to debug structure
        if (sdnEntries.length > 0) {
            console.log('\nSample entry structure:');
            console.log(JSON.stringify(sdnEntries[0], null, 2));
        }

        const addresses = {};
        let processedEntries = 0;
        let foundAddresses = 0;

        for (const entry of sdnEntries) {
            processedEntries++;
            if (processedEntries % 1000 === 0) {
                console.log(`Processed ${processedEntries}/${sdnEntries.length} entries...`);
            }

            try {
                if (!entry.idList?.id) continue;
                
                // Ensure id is always an array
                const ids = Array.isArray(entry.idList.id) ? entry.idList.id : [entry.idList.id];

                for (const id of ids) {
                    // Log all ID types for debugging
                    if (id.idType) {
                        console.log(`Found ID type: ${id.idType}`);
                    }

                    if (id.idType?.toLowerCase().includes('digital currency')) {
                        const address = (id.idNumber || '').toLowerCase();
                        if (!address || address.length < 10) continue;

                        foundAddresses++;
                        console.log(`Found address #${foundAddresses}: ${address}`);

                        // Get publication date - log the structure
                        console.log('Publication info:', entry.publishInformation);
                        let dateStr = 'Date not specified';
                        if (entry.publishInformation && entry.publishInformation[0]) {
                            dateStr = entry.publishInformation[0].publishDate || dateStr;
                        }

                        // Get program list
                        const programs = Array.isArray(entry.programList?.program) 
                            ? entry.programList.program 
                            : [entry.programList?.program || 'Not specified'];

                        addresses[address] = {
                            entity: entry.firstName || entry.lastName || 'Unknown Entity',
                            program: programs.join(', '),
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

        console.log('\nProcessing Summary:');
        console.log(`Raw XML matches found: ${rawMatchCount}`);
        console.log(`Total entries processed: ${processedEntries}`);
        console.log(`Total addresses found: ${foundAddresses}`);
        console.log(`Unique addresses: ${Object.keys(addresses).length}`);

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
        console.log(`Total addresses in output: ${Object.keys(addresses).length}`);

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