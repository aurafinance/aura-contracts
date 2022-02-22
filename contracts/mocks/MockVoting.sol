// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

contract MockVoting {
    mapping(address => uint256) public gaugeWeights;

    mapping(uint256 => uint256) public votesFor;

    mapping(uint256 => uint256) public votesAgainst;

    function vote(
        uint256 voteId,
        bool support,
        bool
    ) external {
        if (support) {
            votesFor[voteId]++;
        } else {
            votesAgainst[voteId]++;
        }
    }

    // This doesn't actually get used by the contracts ever and it's probably easier
    // to just use `votesFor` and `votesAgainst` for testing. It was only in the
    // interface for testing when Convex were using it.
    function getVote(uint256 voteId)
        external
        view
        returns (
            bool status,
            bool,
            uint64,
            uint64,
            uint64,
            uint64,
            uint256 forVotes,
            uint256 againstVotes,
            uint256,
            bytes memory
        )
    {
        status = false;
        forVotes = votesFor[voteId];
        againstVotes = votesAgainst[voteId];
    }

    function vote_for_gauge_weights(address gauge, uint256 weight) external {
        gaugeWeights[gauge] += weight;
    }

    function get_gauge_weight(address gauge) external view returns (uint256) {
        return gaugeWeights[gauge];
    }
}
