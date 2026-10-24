// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SimPriceFeed
/// @notice Chainlink AggregatorV3-compatible price feed whose answer is pushed by a single immutable
/// `updater`. FOR SIMULATION FORKS ONLY (anvil fork of Arbitrum One, chain id `SIM_CHAIN_ID`).
/// Simnet points the fork's AaveOracle WETH source at this feed so that Aave and the Guardian keep
/// reading the AaveOracle (invariant I5) while simnet drives the price. Never deploy to a real network.
contract SimPriceFeed {
    struct Round {
        int256 answer;
        uint64 startedAt;
        uint64 updatedAt;
    }

    uint8 public constant decimals = 8;
    uint256 public constant version = 4;

    address public immutable updater;
    string public description;

    uint80 public latestRound;
    mapping(uint80 roundId => Round) private _rounds;

    event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt);

    error Unauthorized();
    error InvalidAnswer();
    error NoDataPresent();

    constructor(address updater_, int256 initialAnswer, string memory description_) {
        if (updater_ == address(0)) revert Unauthorized();
        updater = updater_;
        description = description_;
        _push(initialAnswer);
    }

    /// @notice Pushes a new answer (8 decimals) as a new round. Callable only by `updater`.
    function setAnswer(int256 answer) external {
        if (msg.sender != updater) revert Unauthorized();
        _push(answer);
    }

    function latestAnswer() external view returns (int256) {
        return _rounds[latestRound].answer;
    }

    function latestTimestamp() external view returns (uint256) {
        return _rounds[latestRound].updatedAt;
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return getRoundData(latestRound);
    }

    function getRoundData(uint80 roundId)
        public
        view
        returns (uint80, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        Round memory r = _rounds[roundId];
        if (r.updatedAt == 0) revert NoDataPresent();
        return (roundId, r.answer, r.startedAt, r.updatedAt, roundId);
    }

    function _push(int256 answer) private {
        if (answer <= 0) revert InvalidAnswer();
        uint80 roundId = latestRound + 1;
        latestRound = roundId;
        _rounds[roundId] = Round(answer, uint64(block.timestamp), uint64(block.timestamp));
        emit AnswerUpdated(answer, roundId, block.timestamp);
    }
}
