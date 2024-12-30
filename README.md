# Crypto Sanctions List

This repository provides a collection of cryptocurrency wallet addresses sanctioned by the U.S. Office of Foreign Assets Control (OFAC). The goal is to assist developers, compliance teams, and law enforcement in identifying and avoiding interactions with these addresses.

## Overview

Cryptocurrencies can be misused for illicit purposes due to their pseudonymous nature and global accessibility. To address this, OFAC maintains a list of cryptocurrency wallet addresses associated with sanctioned entities.

This repository automates the extraction of data from the official OFAC source file and generates a machine-readable JSON file for easy integration into compliance systems, transaction monitoring tools, and investigations.

## Data Source

The wallet addresses are sourced directly from the OFAC Specially Designated Nationals (SDN) list, specifically the [OFAC Sanctions List file in XML format](https://sanctionslist.ofac.treas.gov/Home/SdnList). This list is updated regularly to reflect the most current sanctions.

## Repository Structure

- **`.github/workflows/`**: Contains GitHub Actions workflows for automating tasks, such as running scripts or tests on a schedule. For instance, a daily cron job to execute the script and commit updates to the repository.

- **`data/`**: Contains the automatically generated JSON file of sanctioned cryptocurrency wallet addresses. This file is updated daily using the latest data from OFAC.

- **`node_modules/`**: Contains Node.js packages and dependencies required for the project's scripts.

- **`scripts/`**: Includes the automation scripts used to:
  - Download the OFAC XML file.
  - Parse the XML data to extract sanctioned wallet addresses.
  - Generate the `data/sanctioned_addresses.json` file.

- **`README.md`**: Provides an overview of the repository, instructions for use, and important links.

- **`package.json`**: Specifies the project's metadata, scripts, and dependencies.

- **`package-lock.json`**: Records the exact versions of installed dependencies to ensure consistent installations.

## Automation

The script in this repository automates the following processes:

1. Downloads the latest OFAC sanctions list in XML format from the official source.
2. Extracts cryptocurrency wallet addresses and saves them in a structured file (`data/sanctioned_addresses.json`).
3. Updates the data folder daily to ensure the information remains current and accurate.

<img width="675" alt="image" src="https://github.com/user-attachments/assets/8d00f66f-77d0-4fa1-b8c0-f48512b32c30" />

Users do not need to manually update the data; the repository handles this automatically.

## Usage

This repository is useful for:

- **Compliance Teams**: Screening transactions against sanctioned addresses to prevent unauthorized transfers.
- **Developers**: Integrating sanctions screening into blockchain applications.
- **Law Enforcement**: Supporting investigations by providing a structured, up-to-date list of sanctioned wallet addresses.

### Accessing the Data

The generated file, `data/sanctioned_addresses.json`, contains all wallet addresses identified by OFAC. This file is updated daily, ensuring users always have access to the most current data.

## Contributing

Contributions are not accepted at this time to maintain data integrity. The repository strictly uses the official OFAC source to ensure accuracy.

## Disclaimer

This repository is provided for informational purposes only. While every effort is made to ensure accuracy, users should verify the data against the official OFAC website and perform additional due diligence as necessary.

## License

This project is licensed under the MIT License. See the [LICENSE](https://opensource.org/licenses/MIT) file for more details.
