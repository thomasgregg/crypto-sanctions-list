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
            removeNSPrefix: true // Remove namespace prefixes
        });

        console.log('Parsing XML data...');
        const result = parser.parse(xmlContent);
        
        // Navigate to the DistinctParties section which contains the entries
        const entries = result?.Sanctions?.DistinctParties?.DistinctParty || [];
        console.log(`Found ${entries.length} distinct parties to process...`);

        const addresses = {};
        let processedEntries = 0;
        let foundAddresses = 0;

        for (const party of entries) {
            processedEntries++;
            if (processedEntries % 1000 === 0) {
                console.log(`Processed ${processedEntries}/${entries.length} entries...`);
            }

            try {
                // Check for IDs section
                const ids = party.IDs?.ID;
                if (!ids) continue;

                const idList = Array.isArray(ids) ? ids : [ids];

                for (const id of idList) {
                    // Check if this is a cryptocurrency address
                    if (id?.IDType?.text?.toLowerCase().includes('digital currency')) {
                        const address = (id.IDNumber || '').toLowerCase();
                        if (!address) continue;

                        foundAddresses++;

                        // Get party details
                        const partyName = party.PartyName?.[0]?.text || 'Unknown Entity';
                        const programs = party.Sanctions?.SanctionsProgram;
                        const programString = Array.isArray(programs)
                            ? programs.map(p => p.text).join(', ')
                            : (programs?.text || 'Not specified');

                        // Get registration date
                        let dateStr = party.Sanctions?.RegistrationDate || 'Date not specified';
                        
                        // Get remarks if any
                        const remarks = party.Remarks || 'Listed on OFAC SDN List';

                        addresses[address] = {
                            entity: partyName,
                            program: programString,
                            date: dateStr,
                            reason: remarks,
                            type: id.IDType.text
                        };

                        console.log(`Found crypto address #${foundAddresses}: ${address} (${partyName})`);
                    }
                }
            } catch (error) {
                console.error(`Error processing entry ${processedEntries}:`, error.message);
            }
        }

        console.log(`\nProcessing complete:`);
        console.log(`Total entries processed: ${processedEntries}`);
        console.log(`Total addresses found: ${foundAddresses}`);

        if (foundAddresses === 0) {
            console.warn('Warning: No cryptocurrency addresses were found in the data');
            // Log some sample data for debugging
            console.log('Sample entry structure:', JSON.stringify(entries[0], null, 2).substring(0, 1000));
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