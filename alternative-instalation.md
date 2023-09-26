# Alternative Install Script for Leon

This is an alternative install script for Leon, a tool for compressing and decompressing DNA and RNA sequences. This script will check if Node.js and npm are installed, and if not, it will install them using `apt-fast`. Then, it will install Leon using `npx`, and run Leon using the `start` command.

## Prerequisites

- Node.js >= 16
- npm >= 8
- Kali Linux Purple (Distributor ID: Kali, Description: Kali GNU/Linux Rolling, Release: 2023.3, Codename: kali-rolling)

## Installation

1. Clone this repository to your local machine.
2. Open a terminal and navigate to the directory where the script is located.
3. Run the script using the command `./alternative-install.sh`.

## Usage

1. After running the script, Leon will be installed and started automatically.
2. Access Leon by opening a web browser and navigating to `http://localhost:1337`.

## Notes

- This script uses `apt-fast` to install Node.js and npm. If you do not have `apt-fast` installed, you can install it using the command `sudo apt-get install apt-fast`.
- `npx` is a utility that comes with Node.js version 5.2.0 or newer. It is used to run npm commands without having to install packages globally.
- This script assumes that you are using Kali Linux Purple. If you are using a different operating system, you may need to modify the script accordingly.
