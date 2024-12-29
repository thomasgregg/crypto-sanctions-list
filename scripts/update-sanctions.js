const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'sanctioned-addresses.json');
const DEBUG_DIR = path.join(__dirname, '..', 'debug');
const SDN_LIST_URL = 'https://www.treasury.gov/ofac/downloads/sdn.xml';

async function dumpDebugInfo(rawXml, parsedData) {
    await fs.mkdir(DEBUG_DIR, { recursive: true });
    await fs.writeFile(path.join(DEBUG_DIR, 'raw_sdn.xml'), rawXml);
    await fs.writeFile(
        path.join(DEBUG_DIR, 'parsed_data.json'), 
        JSON.stringify(parsedData, null, 2)
    );
}

async function findAllCryptoAddresses(xmlContent) {
    // Simple regex pattern to find lines containing "Digital Currency Address"
    const pattern = /Digital Currency Address[^<]+<\/id>/g;
    const matches = xmlContent.match(pattern) || [];
    
    console.log('\nDirect XML search results:');
    console.log(`Found ${matches.length} potential crypto address entries in raw XML`);
    
    // Save matches to debug file
    await fs.writeFile(
        path.join(DEBUG_DIR, 'raw_matches.txt'),
        matches.join('\n')
    );

    return matches.length;
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
            isArray: (name, jpath, isLeafNode, isAttribute) => {
                // Force these to always be arrays
                return name === 'sdnEntry' || 
                       name === 'id' || 
                       name === 'program' ||
                       name === 'publishInformation';
            }
        });

        console.log('Parsing XML data...');
        const result = parser.parse(xmlContent);
        
        // Save debug info
        await dumpDebugInfo(xmlContent, result);

        const sdnEntries = result?.sdnList?.sdnEntry || [];
        console.log(`Found ${sdnEntries.length} SDN entries to process...`);

        const addresses = {};
        let processedEntries = 0;
        let foundAddresses = 0;

        // Create a map to track addresses and their sources
        const addressSources = new Map();

        for (const entry of sdnEntries) {
            processedEntries++;
            
            try {
                const ids = entry.idList?.id || [];
                
                for (const id of ids) {
                    if (id?.idType?.toLowerCase().includes('digital currency')) {
                        const address = (id.idNumber || '').toLowerCase();
                        if (!address || address.length < 10) continue;

                        foundAddresses++;

                        // Track where we found this address
                        if (!addressSources.has(address)) {
                            addressSources.set(address, []);
                        }
                        addressSources.get(address).push({
                            entity: entry.firstName || entry.lastName || 'Unknown',
                            id: id.idType
                        });

                        // Get program list
                        const programs = entry.programList?.program || [];
                        const programString = programs.join(', ') || 'Not specified';

                        // Get entity name
                        const entityName = entry.firstName || entry.lastName || 'Unknown Entity';

                        // Get publication date with debug info
                        let dateStr = 'Date not specified';
                        if (entry.publishInformation && entry.publishInformation.length > 0) {
                            dateStr = entry.publishInformation[0].publishDate || dateStr;
                            console.log(`Found date for ${address}: ${dateStr}`);
                            console.log('Publication info:', JSON.stringify(entry.publishInformation[0]));
                        }

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

        // Save address sources to debug file
        const addressSourcesDebug = Object.fromEntries(addressSources);
        await fs.writeFile(
            path.join(DEBUG_DIR, 'address_sources.json'),
            JSON.stringify(addressSourcesDebug, null, 2)
        );

        console.log('\nProcessing Summary:');
        console.log(`Raw XML matches found: ${rawMatchCount}`);
        console.log(`Total entries processed: ${processedEntries}`);
        console.log(`Total addresses found: ${foundAddresses}`);
        console.log(`Unique addresses: ${Object.keys(addresses).length}`);

        // Write a comparison file
        const comparisonData = {
            rawMatchCount,
            processedCount: processedEntries,
            foundAddressesCount: foundAddresses,
            uniqueAddressesCount: Object.keys(addresses).length,
            addressSources: Object.fromEntries(addressSources)
        };
        await fs.writeFile(
            path.join(DEBUG_DIR, 'comparison.json'),
            JSON.stringify(comparisonData, null, 2)
        );

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

        return sanctionsData;
    } catch (error) {
        console.error('Error in updateSanctionsList:', error);
        throw error;
    }
}

updateSanctionsList()
    .then(() => {
        console.log('\nUpdate completed successfully');
        console.log('Debug files have been written to the debug directory');
        process.exit(0);
    })
    .catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });