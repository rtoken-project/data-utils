require("dotenv").config();
const ethers = require("ethers");
const axios = require("axios");
const RTokenAnalytics = require("../src/rtoken-analytics");
const Registry = require("eth-registry");
var test = require("mocha").describe;
var assert = require("chai").assert;

const BigNumber = require("bignumber.js");

// NOTE: Compound API is super slow. Use hard coded value instead.
const debug = {
  hardCodeInterestRate: "0.048356383475363732",
  // hardCodeInterestRate: false
};

const COMPOUND_URL = "https://api.compound.finance/api/v2/ctoken?addresses[]=";
const daiCompoundAddress = "0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643";

// NOTE: change these if you are using a custom rToken (e.g. not rDAI)
// A should be sending interest to B
const userA = "0x9492510bbcb93b6992d8b7bb67888558e12dcac4";
const userB = "0x8605e554111d8ea3295e69addaf8b2abf60d68a3";

const interestTolerance = 0;
const network = "mainnet";
const subgraphURL = process.env.SUBGRAPH_URL;
const rdaiSubgraphId = process.env.SUBGRAPH_ID;
const isLocal = process.env.LOCAL;

test("RTokenAnalytics", async (accounts) => {
  let rtokenAnalytics;

  before(async () => {
    let compoundRate = debug.hardCodeInterestRate;
    if (!debug.hardCodeInterestRate) {
      compoundRate = await getCompoundRate();
    }

    console.log("Subgraph URL     : ", subgraphURL);
    console.log("Subgraph ID rDAI : ", rdaiSubgraphId);
    console.log(
      "Local test       : ",
      typeof isLocal === "undefined" ? false : true
    );
    console.log(process.env.INFURA_ENDPOINT_KEY);
    const web3Provider = new ethers.providers.InfuraProvider(
      "homestead",
      process.env.INFURA_ENDPOINT_KEY
    );

    const options = {
      interestRate: compoundRate, // Currently unused
      interestTolerance, // Currently unused
      rdaiSubgraphId,
      subgraphURL,
      web3Provider,
      infuraEndpointKey: process.env.INFURA_ENDPOINT_KEY,
    };
    rtokenAnalytics = new RTokenAnalytics(options);
  });

  it("getAllOutgoing()", async () => {
    let outgoing = await rtokenAnalytics.getAllOutgoing(userA);
    assert.isAbove(outgoing.length, 0, "no outgoing were returned");
  });

  it("getAllIncoming()", async () => {
    let incoming = await rtokenAnalytics.getAllIncoming(userB);
    assert.isAbove(incoming.length, 0, "no incoming were returned");
  });

  it("getInterestSent()", async () => {
    let interestSent = await rtokenAnalytics.getInterestSent(userA, userB);
    let interest = new BigNumber(interestSent);
    console.log("interest sent    : ", interest.toNumber());
    assert.isOk(interest.isGreaterThan(0), "no interest has been paid");
  });

  // it('getTotalInterestPaid()', async () => {
  //   let totalInterestPaid = await rtokenAnalytics.getTotalInterestPaid(userC);
  //   let interest = new BigNumber(totalInterestPaid);
  //   assert.isOk(interest.isGreaterThan(0), 'no interest has been paid');
  // });
});

const getCompoundRate = async () => {
  try {
    const res = await axios.get(`${COMPOUND_URL}${daiCompoundAddress}`);
    const compoundRate = res.data.cToken[0].supply_rate.value;
    const compoundRateFormatted = Math.round(compoundRate * 10000) / 100;
    console.log(`\nCurrent Compound Rate: ${compoundRateFormatted}%`);
    return {
      compoundRate,
    };
  } catch (e) {
    console.log(e.msg);
    return { e };
  }
};
