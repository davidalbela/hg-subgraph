import { crypto, Address, BigInt, Bytes } from '@graphprotocol/graph-ts'
import { ConditionPreparation, ConditionResolution, PositionSplit, PositionsMerge, PredictionMarketSystem } from './types/PredictionMarketSystem/PredictionMarketSystem'
import { Condition, Collection, Position } from './types/schema'

export function handleConditionPreparation(event: ConditionPreparation): void {
  let condition = new Condition(event.params.conditionId.toHex())
  condition.creator = event.transaction.from
  condition.oracle = event.params.oracle
  condition.questionId = event.params.questionId
  condition.outcomeSlotCount = event.params.outcomeSlotCount.toI32()
  condition.resolved = false
  condition.createTransaction = event.transaction.hash
  condition.creationTimestamp = event.block.timestamp
  condition.blockNumber = event.block.number
  condition.save()
}

export function handleConditionResolution(event: ConditionResolution): void {
  let condition = Condition.load(event.params.conditionId.toHex())
  condition.payoutNumerators = event.params.payoutNumerators
  let denominator: BigInt = sum(event.params.payoutNumerators)
  condition.payoutDenominator = denominator
  condition.resolveTransaction = event.transaction.hash
  condition.resolveTimestamp = event.block.timestamp
  condition.resolved = true;
  condition.save()
}

export function handlePositionSplit(event: PositionSplit): void {
  let params = event.params
  let partition = params.partition

  let conditionId = params.conditionId.toHex()
  let condition = Condition.load(conditionId)

  let parentIndexSet = sum(partition)
  let parentConditions: Array<String>
  let parentIndexSets: Array<BigInt>
  if(isFullIndexSet(parentIndexSet, condition.outcomeSlotCount)) {
    if(isZeroCollectionId(params.parentCollectionId)) {
      parentConditions = []
      parentIndexSets = []
    } else {
      let parentCollection = Collection.load(params.parentCollectionId.toHex())
      parentConditions = parentCollection.conditions
      parentIndexSets = parentCollection.indexSets
    }
  } else {
    let collectionId = add256(params.parentCollectionId, toCollectionId(params.conditionId, parentIndexSet))
    let parentCollection = Collection.load(collectionId.toHex())
    parentConditions = new Array<String>(parentCollection.conditions.length - 1)
    parentIndexSets = new Array<BigInt>(parentConditions.length)

    for(let i = 0, j = 0; i < parentCollection.conditions.length; i++) {
      let parentCollectionConditions = parentCollection.conditions
      let parentCollectionIndexSets = parentCollection.indexSets
      if(parentCollectionConditions[i] !== conditionId) {
        parentConditions[j] = parentCollectionConditions[i]
        parentIndexSets[j] = parentCollectionIndexSets[i]
        j++
      }
    }
  }

  for (let i=0; i<partition.length; i++) {
    let collectionId = add256(params.parentCollectionId, toCollectionId(params.conditionId, partition[i]))
    let collection = Collection.load(collectionId.toHex())
    if (collection == null) {
      collection = new Collection(collectionId.toHex())
      let conditions = new Array<String>(parentConditions.length + 1)
      let indexSets = new Array<BigInt>(parentConditions.length + 1)
      for(let j = 0; j < parentConditions.length; j++) {
        conditions[j] = parentConditions[j]
        indexSets[j] = parentIndexSets[j]
      }
      conditions[parentConditions.length] = conditionId
      indexSets[parentConditions.length] = partition[i]
      collection.conditions = conditions
      collection.indexSets = indexSets
      collection.save()
    }
    
    let positionId = toPositionId(params.collateralToken, collectionId)
    let position = Position.load(positionId.toHex())
    if (position == null) {
      position = new Position(positionId.toHex())
      position.collateralToken = params.collateralToken
      position.collection = collection.id
      position.save()
    }
  }
}

export function handlePositionsMerge(event: PositionsMerge): void {
  // stub
}

// Helper functions (mandated by AssemblyScript for memory issues)
function sum(a: BigInt[]): BigInt {
  let result: BigInt = 0;
  for (let i = 0; i < a.length; i++) {
    result = result + a[i]
  }
  return result;
}

function toCollectionId(conditionId: Bytes, indexSet: BigInt): Bytes {
  let hashPayload = new Uint8Array(64)
  hashPayload.fill(0)
  for(let i = 0; i < conditionId.length && i < 32; i++) {
    hashPayload[i] = conditionId[i]
  }
  for(let i = 0; i < indexSet.length && i < 32; i++) {
    hashPayload[63 - i] = indexSet[i]
  }
  return crypto.keccak256(hashPayload as Bytes) as Bytes
}

function toPositionId(collateralToken: Address, collectionId: Bytes): Bytes {
  let hashPayload = new Uint8Array(52)
  hashPayload.fill(0)
  for(let i = 0; i < collateralToken.length && i < 20; i++) {
    hashPayload[i] = collateralToken[i]
  }
  for(let i = 0; i < collectionId.length && i < 32; i++) {
    hashPayload[i + 20] = collectionId[i]
  }
  return crypto.keccak256(hashPayload as Bytes) as Bytes
}

function add256(a: Bytes, b: Bytes): Bytes {
  let aBigInt = new Uint8Array(32) as BigInt
  let bBigInt = new Uint8Array(32) as BigInt

  aBigInt.fill(0)
  for(let i = 0; i < a.length && i < 32; i++) {
    aBigInt[i] = a[a.length - 1 - i]
  }

  bBigInt.fill(0)
  for(let i = 0; i < b.length && i < 32; i++) {
    bBigInt[i] = b[b.length - 1 - i]
  }

  let sumBigInt = aBigInt + bBigInt
  let sum = new Uint8Array(32) as Bytes
  sum.fill(0)
  for(let i = 0; i < sumBigInt.length && i < 32; i++) {
    sum[31 - i] = sumBigInt[i]
  }

  return sum
}

function isFullIndexSet(indexSet: BigInt, outcomeSlotCount: i32): boolean {
  for(let i = 0; i < indexSet.length && 8 * i < outcomeSlotCount; i++) {
    let bitsLeft = outcomeSlotCount - 8 * i
    if(bitsLeft < 8) {
      if(indexSet[i] !== (1 << (bitsLeft as u8)) - 1) return false
    } else {
      if(indexSet[i] !== 0xff) return false
    }
  }
  return true
}

function isZeroCollectionId(collectionId: Bytes): boolean {
  for(let i = 0; i < collectionId.length; i++)
    if(collectionId[i] !== 0)
      return false
  return true
}
