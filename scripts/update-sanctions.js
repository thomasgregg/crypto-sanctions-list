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
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            responseType: 'text',
            decompress: true
        });

        const xmlContent = response.data;
        console.log('Received XML data, size:', Buffer.byteLength(xmlContent, 'utf8') / 1024 / 1024, 'MB');

        // Debug: Check first few characters of XML
        console.log('First 500 characters of XML:', xmlContent.substring(0, 500));

        // Debug: Check if it's valid XML structure
        if (!xmlContent.trim().startsWith('<?xml')) {
            console.error('Content does not start with XML declaration');
            // Try to write the content to a file for inspection
            await fs.writeFile('debug_response.txt', xmlContent.substring(0, 5000));
            throw new Error('Invalid XML content received');
        }

        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '',
            parseAttributeValue: true,
            allowBooleanAttributes: true,
            textNodeName: 'text',
            numberParseOptions: {
                skipLike: /[0-9]+/
            },
            parseTagValue: true,
            trimValues: true,
            parseAttributeValue: false,
            cdataPropName: "__cdata",
            processEntities: true
        });

        console.log('Parsing XML data...');
        let result;
        try {
            result = parser.parse(xmlContent);
            // Debug: Log the parsed structure
            console.log('Parsed XML structure keys:', Object.keys(result));
            if (result.sdnList) {
                console.log('SDN List keys:', Object.keys(result.sdnList));
            }
        } catch (parseError) {
            console.error('XML parsing error:', parseError);
            // Try to determine where the parsing failed
            const errorPosition = parseError.message.match(/\d+/)?.[0];
            if (errorPosition) {
                console.log('XML content around error:', xmlContent.substring(
                    Math.max(0, parseInt(errorPosition) - 100),
                    parseInt(errorPosition) + 100
                ));
            }
            throw parseError;
        }

        if (!result || !result.sdnList || !result.sdnList.sdnEntry) {
            console.error('Unexpected XML structure:', JSON.stringify(result, null, 2).substring(0, 1000));
            throw new Error('Invalid XML structure');
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

                        // Get publication date
                        const publishInfo = entry.publishInformation;
                        let dateStr = 'Date not specified';
                        if (publishInfo) {
                            if (Array.isArray(publishInfo)) {
                                dateStr = publishInfo[0]?.publishDate || dateStr;
                            } else {
                                dateStr = publishInfo.publishDate || dateStr;
                            }
                        }

                        addresses[address] = {
                            entity: entityName,
                            program: programString,
                            date: dateStr,
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
                source: 'OFAC SDN Advanced List',
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

// Run the update
updateSanctionsList()
    .then(() => {
        console.log('Update completed successfully');
        process.exit(0);
    })
    .catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });