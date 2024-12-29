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
            removeNSPrefix: true
        });

        console.log('Parsing XML data...');
        const result = parser.parse(xmlContent);
        
        // Log reference value sets to see ID types
        console.log('\nAvailable ID Types:');
        const idTypes = result?.Sanctions?.ReferenceValueSets?.IDTypeValues?.IDType || [];
        idTypes.forEach(type => {
            console.log(`- ${type.text} (ID: ${type.ID})`);
        });

        const entries = result?.Sanctions?.DistinctParties?.DistinctParty || [];
        console.log(`\nFound ${entries.length} distinct parties to process...`);

        // Sample the first few entries that have IDs
        console.log('\nSampling first few entries with IDs:');
        let sampledEntries = 0;
        for (const party of entries) {
            if (party.IDs?.ID && sampledEntries < 5) {
                console.log('\nParty:', party.PartyName?.[0]?.text);
                const ids = Array.isArray(party.IDs.ID) ? party.IDs.ID : [party.IDs.ID];
                console.log('ID Types found:', ids.map(id => id?.IDType?.text));
                sampledEntries++;
            }
        }

        const addresses = {};
        let processedEntries = 0;
        let foundAddresses = 0;
        let uniqueIdTypes = new Set();

        for (const party of entries) {
            processedEntries++;
            if (processedEntries % 1000 === 0) {
                console.log(`Processed ${processedEntries}/${entries.length} entries...`);
            }

            try {
                const ids = party.IDs?.ID;
                if (!ids) continue;

                const idList = Array.isArray(ids) ? ids : [ids];

                // Collect all ID types for debugging
                idList.forEach(id => {
                    if (id?.IDType?.text) {
                        uniqueIdTypes.add(id.IDType.text);
                    }
                });

                for (const id of idList) {
                    // Check for various cryptocurrency-related ID types
                    const idType = id?.IDType?.text;
                    if (idType && (
                        idType.toLowerCase().includes('digital currency') ||
                        idType.toLowerCase().includes('virtual currency') ||
                        idType.toLowerCase().includes('crypto') ||
                        idType.toLowerCase().includes('wallet')
                    )) {
                        const address = (id.IDNumber || '').toLowerCase();
                        if (!address) continue;

                        console.log(`\nFound potential crypto address:`);
                        console.log(`Type: ${idType}`);
                        console.log(`Address: ${address}`);
                        console.log(`Entity: ${party.PartyName?.[0]?.text}`);

                        foundAddresses++;
                        const partyName = party.PartyName?.[0]?.text || 'Unknown Entity';
                        const programs = party.Sanctions?.SanctionsProgram;
                        const programString = Array.isArray(programs)
                            ? programs.map(p => p.text).join(', ')
                            : (programs?.text || 'Not specified');

                        addresses[address] = {
                            entity: partyName,
                            program: programString,
                            date: party.Sanctions?.RegistrationDate || 'Date not specified',
                            reason: party.Remarks || 'Listed on OFAC SDN List',
                            type: idType
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

updateSanctionsList()
    .then(() => {
        console.log('Update completed successfully');
        process.exit(0);
    })
    .catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });