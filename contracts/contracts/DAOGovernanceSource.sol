// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ICredentialHook} from "./interfaces/ICredentialHook.sol";
import {ICredentialSource} from "./interfaces/ICredentialSource.sol";
import {IGovernor} from "./interfaces/IGovernor.sol";

contract DAOGovernanceSource is ICredentialSource {
    struct GovernanceActivity {
        uint256 activityId;
        address participant;
        address governorContract;
        uint256 proposalId;
        bool credentialClaimed;
        uint256 claimedAt;
    }

    uint256 public constant CREDENTIAL_COOLDOWN = 6 hours;

    address public owner;
    address public immutable hook;
    uint256 public nextActivityId;
    mapping(address => bool) public approvedGovernors;
    mapping(address => mapping(address => mapping(uint256 => bool))) public claimed;
    mapping(address => uint256) public lastCredentialClaim;
    mapping(uint256 => GovernanceActivity) public activities;
    mapping(address => uint256[]) public activitiesByParticipant;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event GovernorApprovalUpdated(address indexed governorContract, bool approved);
    event GovernanceCredentialClaimed(
        uint256 indexed activityId,
        address indexed participant,
        address indexed governorContract,
        uint256 proposalId,
        uint256 credentialRecordId,
        uint256 weight
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    constructor(address hookAddress) {
        require(hookAddress != address(0), "invalid hook");
        owner = msg.sender;
        hook = hookAddress;
    }

    function sourceType() external pure returns (string memory) {
        return "dao_governance";
    }

    function sourceName() external pure returns (string memory) {
        return "DAO Governance";
    }

    function hasEscrow() external pure returns (bool) {
        return false;
    }

    function credentialWeight() external pure returns (uint256) {
        return 90;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "invalid owner");
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function addGovernor(address governorContract) external onlyOwner {
        require(governorContract != address(0), "invalid governor");
        approvedGovernors[governorContract] = true;
        emit GovernorApprovalUpdated(governorContract, true);
    }

    function removeGovernor(address governorContract) external onlyOwner {
        require(governorContract != address(0), "invalid governor");
        approvedGovernors[governorContract] = false;
        emit GovernorApprovalUpdated(governorContract, false);
    }

    function claimGovernanceCredential(
        address governorContract,
        uint256 proposalId
    ) external returns (uint256 activityId, uint256 credentialRecordId) {
        require(approvedGovernors[governorContract], "governor not approved");
        require(IGovernor(governorContract).hasVoted(proposalId, msg.sender), "vote not found");
        require(!claimed[msg.sender][governorContract][proposalId], "already claimed");
        require(
            block.timestamp >= lastCredentialClaim[msg.sender] + CREDENTIAL_COOLDOWN,
            "credential cooldown active"
        );

        claimed[msg.sender][governorContract][proposalId] = true;
        lastCredentialClaim[msg.sender] = block.timestamp;

        activityId = nextActivityId;
        nextActivityId += 1;
        activities[activityId] = GovernanceActivity({
            activityId: activityId,
            participant: msg.sender,
            governorContract: governorContract,
            proposalId: proposalId,
            credentialClaimed: true,
            claimedAt: block.timestamp
        });
        activitiesByParticipant[msg.sender].push(activityId);

        credentialRecordId = ICredentialHook(hook).onActivityComplete(
            msg.sender,
            activityId,
            "dao_governance",
            90
        );
        emit GovernanceCredentialClaimed(
            activityId,
            msg.sender,
            governorContract,
            proposalId,
            credentialRecordId,
            90
        );
    }
}
