require("babel-polyfill");
const { execute, makePromise } = require("apollo-link");
const gql = require("graphql-tag");
const axios = require("axios");
const fetch = require("cross-fetch");
const { createHttpLink } = require("apollo-link-http");

const ethers = require("ethers");
const { parseUnits, formatUnits, bigNumberify } = ethers.utils;

const BigNumber = require("bignumber.js");
const CONTRACTS = require("./constants");

const DEFAULT_SUBGRAPH_URL = "https://api.thegraph.com/subgraphs/id/";
const DEFAULT_SUBGRAPH_ID_RDAI =
  "QmfUZ16H2GBxQ4eULAELDJjjVZcZ36TcDkwhoZ9cjF2WNc";

class RTokenAnalytics {
  constructor(options = {}) {
    this.web3Provider = options.web3Provider; // Curently unused
    this.interestRate = options.interestRate || 0; // Currently unused
    this.interestTolerance = options.interestTolerance || 0; // Currently unused
    this.network = options.network || "homestead";
    this.infuraEndpointKey = options.infuraEndpointKey || "";
    const url = options.subgraphURL || DEFAULT_SUBGRAPH_URL;
    const rdai_id = options.rdaiSubgraphId || DEFAULT_SUBGRAPH_ID_RDAI;
    this.rTokenLink = new createHttpLink({
      uri: `${url}${rdai_id}`,
      fetch: fetch,
    });
    this.web3Provider = this.getWeb3Provider(
      this.network,
      this.infuraEndpointKey
    );
  }

  getWeb3Provider(network, infuraEndpointKey) {
    try {
      const web3Provider = new ethers.providers.InfuraProvider(
        network,
        infuraEndpointKey
      );
      return web3Provider;
    } catch (error) {
      console.log("error setting up web3 provider: ", error);
      return;
    }
  }

  async getContract(name) {
    const contract = new ethers.Contract(
      CONTRACTS[name][this.network],
      CONTRACTS[name].abi,
      this.web3Provider
    );
    return contract;
  }

  // USER STATS

  // Returns all interest accrued within time period no matter where it was sent
  getTotalInterestGenerated(address, timePeriod) {
    // TODO:
    return {};
  }

  // Returns all accrued interest retained by the wallet
  //TODO

  // Returns all interest paid to the user
  async getTotalInterestPaid(address, timePeriod) {
    const operation = {
      query: gql`
        query getUser($id: Bytes) {
          user(id: $id) {
            id
            totalInterestPaid
          }
        }
      `,
      variables: { id: address },
    };
    let res = await makePromise(execute(this.rTokenLink, operation));
    return res.data.user.totalInterestPaid;
  }

  // Returns all interest sent to wallets other than the user’s
  getTotalInterestSent(address, timePeriod) {
    // TODO:
    return {};
  }

  // Returns list of addresses that an address has sent interest to
  async getAllOutgoing(address, timePeriod) {
    const operation = {
      query: gql`
        query getAccount($id: Bytes) {
          account(id: $id) {
            loansOwned {
              amount
              recipient {
                id
              }
              hat {
                id
              }
              transfers {
                value
                transaction {
                  id
                  timestamp
                  blockNumber
                }
              }
            }
          }
        }
      `,
      variables: { id: address },
    };
    let res = await makePromise(execute(this.rTokenLink, operation));
    let loansOwned = [];
    if (res.data.account && res.data.account.loansOwned)
      loansOwned = res.data.account.loansOwned;
    return loansOwned;
  }

  // Returns list of addresses that have sent any interest to this address, and the amounts
  async getAllIncoming(address, timePeriod) {
    const operation = {
      query: gql`
        query getAccount($id: Bytes) {
          account(id: $id) {
            loansReceived {
              amount
              recipient {
                id
              }
              hat {
                id
              }
              transfers {
                value
                transaction {
                  id
                  timestamp
                  blockNumber
                }
              }
            }
          }
        }
      `,
      variables: { id: address },
    };
    let res = await makePromise(execute(this.rTokenLink, operation));
    let loansReceived = [];
    if (res.data.account && res.data.account.loansReceived)
      loansReceived = res.data.account.loansReceived;
    return loansReceived;
  }

  // SENDING / RECEIVING

  // Returns total amount of interest received by an address from all sources
  // Excludes interest generated from user’s own wallet
  getTotalInterestReceivedExternal(address, timePeriod) {
    // TODO:
    return {};
  }

  // Returns total amount of interest received by an address from a single address
  async getInterestSent(addressFrom, addressTo, timePeriod) {
    console.log(addressFrom, addressTo);
    const operation = {
      query: gql`
        query getAccount($from: Bytes, $to: Bytes) {
          account(id: $from) {
            balance
            loansOwned(where: { recipient: $to }) {
              amount
              recipient {
                id
              }
              hat {
                id
              }
              transfers {
                value
                transaction {
                  id
                  timestamp
                  blockNumber
                }
              }
            }
          }
        }
      `,
      variables: {
        from: addressFrom.toLowerCase(),
        to: addressTo.toLowerCase(),
      },
    };
    let res = await makePromise(execute(this.rTokenLink, operation));
    let interestSent = 0;
    let value = new BigNumber(0);
    if (res.data.account.loansOwned.length < 1) return 0;
    const loan = res.data.account.loansOwned[0];
    for (let index = 0; index < loan.transfers.length; index++) {
      const transfer = loan.transfers[index];
      let rate = null;

      // If this is the first transfer, skip it
      if (index === 0) {
        value = value.plus(transfer.value);
        if (loan.transfers.length === 1) {
          const start = transfer.transaction.timestamp;
          const date = new Date();
          const now = Math.round(date.getTime() / 1000);
          rate = await this._getCompoundRate(start);
          interestSent += this._calculateInterestOverTime(
            value,
            start,
            now,
            rate
          );
        }
      }
      // If this is the last transfer, add the accumulated interest until the current time
      else if (index === loan.transfers.length - 1) {
        value = value.plus(transfer.value);

        const start = transfer.transaction.timestamp;
        const date = new Date();
        const now = Math.round(date.getTime() / 1000);

        rate = await this._getCompoundRate(start);
        interestSent += this._calculateInterestOverTime(
          value,
          start,
          now,
          rate
        );
        // console.log('Final ransfer. Current value: ', value.toNumber());
      } else {
        // Normal case: Add the accumulated interest since last transfer
        rate = await this._getCompoundRate(
          loan.transfers[index - 1].transaction.timestamp
        );

        interestSent += this._calculateInterestOverTime(
          value,
          loan.transfers[index - 1].transaction.timestamp,
          transfer.transaction.timestamp,
          rate
        );

        // Add the current transfer value to the running value
        value = value.plus(transfer.value);
      }
    }
    return interestSent;
  }

  _calculateInterestOverTime(value, start, end, startingAPY) {
    const duration = end - start;
    const period = duration / 31557600; // Adjust for APY
    return value * period * startingAPY;
  }

  async _getCompoundRate(blockTimestamp) {
    // Note: This is incorrect. Calculating rate is much more complex than just getting it from storage.
    // I was trying to avoid using compound historic data API, since its so slow...

    let res;
    try {
      res = await this.web3Provider.getStorageAt(
        "0xec163986cC9a6593D6AdDcBFf5509430D348030F",
        1,
        9220708
      );
    } catch (e) {
      console.log(e);
      return 0.001;
    }
    const unformatted_rate = new BigNumber(2102400 * parseInt(res, 16));
    const rate = unformatted_rate.times(BigNumber(10).pow(-18));
    console.log(
      `Compound rate (This is wrong): ${Math.round(rate.toNumber() * 100000) /
        1000}%`
    );
    return rate;

    // Used to inspect storage on a contract
    // for (let index = 0; index < 23; index++) {
    //   const rate = await this.web3Provider.getStorageAt(
    //     '0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643',
    //     index,
    //     9220800
    //   );
    //   // console.log(`[${index}] ${rate}`);
    //   console.log(`[${index}] ${parseInt(rate, 16)}`);
    // }

    // Correct, new way to get the rate (BUT THE API IS DOWN)
    // const COMPOUND_URL =
    //   "https://api.compound.finance/api/v2/market_history/graph?asset=0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643";
    // const params = `&min_block_timestamp=${blockTimestamp}&max_block_timestamp=${blockTimestamp +
    //   1}&num_buckets=1`;
    // // console.log(`${COMPOUND_URL}${params}`);
    // let res;
    // try {
    //   res = await axios.get(`${COMPOUND_URL}${params}`);
    // } catch (error) {
    //   // console.log(error);
    //   return 0.01;
    // }
    // return res.data.supply_rates[0].rate;
  }

  // GLOBAL
  getGlobalInterestGenerated(timePeriod) {
    // TODO:
    return {};
  }

  getGlobalInterestSent(timePeriod) {
    // TODO:
    return {};
  }

  // TOKEN BALANCE TRACKING
  // Returns array of objects for each instance that a address’ rToken balance changes. Object returns:
  getTokenBalanceHistoryByAddress(address, timePeriod) {
    // TODO
    return {
      // Amount of balance change
      // Transaction Hash
    };
  }

  // High Priests Additions
  async receivedSavingsOf(address) {
    const rdai = await this.getContract("rdai");
    const savings = await rdai.receivedSavingsOf(address);
    return savings;
  }
  async receivedSavingsOfByHat(hatID) {
    const rdai = await this.getContract("rdai");
    const { recipients } = await rdai.getHatByID(hatID);
    let savingsSum = bigNumberify(0);
    if (recipients && recipients.length) {
      for (let i = 0; i < recipients.length; i++) {
        const amountBN = await rdai.receivedSavingsOf(recipients[i]);
        savingsSum = savingsSum.add(amountBN);
      }
    }
    return savingsSum.toString();
  }
  async amountEarnedByHat(hatID) {
    const rdai = await this.getContract("rdai");
    const { recipients } = await rdai.getHatByID(hatID);
    let totalEarned = bigNumberify(0);
    if (recipients && recipients.length) {
      for (let i = 0; i < recipients.length; i++) {
        const balanceBN = await rdai.balanceOf(recipients[i]);
        const interestBN = await rdai.interestPayableOf(recipients[i]);
        totalEarned = totalEarned.add(interestBN).add(balanceBN);
      }
    }
    return totalEarned.toString();
  }
  async getHatIDByAddress(address) {
    const rdai = await this.getContract("rdai");
    const hat = await rdai.getHatByAddress(address);
    let hatID = null;
    if (hat) hatID = hat.hatID.toString();
    return hatID;
  }
  async allUsersWithHat(hatID) {
    const operation = {
      query: gql`
        query allUsersWithHat($hatID: String) {
          accounts(
            where: {
              id_not: "0x0000000000000000000000000000000000000000"
              hat: $hatID
            }
          ) {
            id
            balance
            hat {
              id
            }
          }
        }
      `,
      variables: {
        hatID: hatID,
      },
    };
    let res = await makePromise(execute(this.rTokenLink, operation));
    let accounts = [];
    let topDonor = {
      balance: 0,
      id: "",
    };
    if (res.data && res.data.accounts) {
      accounts = res.data.accounts;
      for (let i = 0; i < accounts.length; i++) {
        if (JSON.parse(accounts[i].balance) > topDonor.balance)
          topDonor = accounts[i];
      }
    }
    return { topDonor, accounts };
  }
  async userContributionToHat(hatID, address) {
    const currentHatID = await this.getHatIDByAddress(address);
    if (currentHatID !== hatID) return 0;
    const rdai = await this.getContract("rdai");
    let amount = 0;
    amount = await rdai.balanceOf(address);
    return amount.toString();
  }
  async getTopDonorByHatGroup(hats) {
    const hatsArray = JSON.parse(hats);
    let masterDonor = { id: "null", balance: 0 };
    if (hatsArray && hatsArray.length) {
      for (let i = 0; i < hatsArray.length; i++) {
        const { topDonor } = await this.allUsersWithHat(
          hatsArray[i].toString()
        );

        if (topDonor.balance > masterDonor.balance) masterDonor = topDonor;
      }
    }
    return masterDonor;
  }
  async sortHatsByReceivedSavingsOf(hats) {
    const hatsArray = JSON.parse(hats);
    const rdai = await this.getContract("rdai");
    let hatObjectsArray = [];
    if (hatsArray && hatsArray.length) {
      for (let i = 0; i < hatsArray.length; i++) {
        const { recipients, proportions } = await rdai.getHatByID(hatsArray[i]);
        const receivedSavingsOf = await this.receivedSavingsOfByHat(
          hatsArray[i]
        );
        hatObjectsArray.push({
          recipients,
          proportions,
          hatID: hatsArray[i],
          receivedSavingsOf,
        });
      }
    }
    hatObjectsArray.sort(function(a, b) {
      return b.receivedSavingsOf - a.receivedSavingsOf;
    });
    return hatObjectsArray;
  }
}

module.exports = RTokenAnalytics;
