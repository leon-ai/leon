function getPossibleExpressions(expressionType, count) {
    const data = require('../data/expressions/en.json')
    switch (expressionType) 
    { 
        case "create list":
            return data.todolist.create_list.expressions
        case "view lists":
            return data.todolist.view_lists.expressions
        case "view list":
            return data.todolist.view_list.expressions
        case "rename list":
            return data.todolist.view_list.expressions
        case "delete list":
            return data.todolist.delete_list.expressions
        case "add todos":
            return data.todolist.add_todos.expressions
        case "complete todos":
            return data.todolist.complete_todos.expressions
        case "uncheck todos":
            return data.todolist.uncheck_todos.expressions
        default:
            console.log("invalid expression type requested")
            break
    }
}

function getOutputs(){
    const fs = require('fs')
    const path = require('path')
    let data = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/db/calendar.spec.json')))
    return data
}

async function testCreateListExpressions(count) {
    const expression = getPossibleExpressions("create list")[count]
    var quote = '\"'
    var expectedIndex = quote.concat(count.toString()).concat('\" list')
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process(expression.replace("x", count))
    var [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])
    return [global.brain.finalOutput, expectedIndex]
}

async function testViewListsExpressions(count) {
    const expression = getPossibleExpressions("view lists")[count]
    var quote = '\"'
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process(expression)
    var [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])
    return global.brain.finalOutput
}

async function testExpression(expression) {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process(expression)
    var [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])
}

async function testExpressions(expressions) {
    for (let i = 0; i < expressions.length; i++){
        await testExpression(expressions[i])
    }
}

function createObjs(){
    var data = getOutputs()
    var todo = data.todo_todos
    var todoObj = {}
    var list = data.todo_lists
    var listObj = {}
    var i = 0

    var todoLen = Object.keys(todo).length
    var listLen = Object.keys(list).length

    for (let i = 1; i < todoLen+1; i++)
        todoObj[i] = {
            "list": todo[i].list,
            "name": todo[i].name,
            "is_completed": todo[i].is_completed
        }
    for (let i = 1; i < listLen+1; i++)
        listObj[i] = {"name": list[i].name}
    
    return [listObj, todoObj]
}

describe('calendar:todolist', async () => {
    test('Create two lists', async () => {
        const expressions = [
            'Create a shopping list',
            'Create a school list'
        ]
        const expected = {
            '1': {
                "name": 'shopping'
            },
            '2': {
                "name": 'school'
            }
        }
        await testExpressions(expressions)
        var list = createObjs()
        expect(JSON.stringify(list[0])).toBe(JSON.stringify(expected))

    })

    test('Add 5 elements to a list 3 individually and 2 at the same time', async () => {
        const expressions = [
            'Add bread to my shopping list',
            'Add milk to my shopping list',
            'Add cheese to the shopping list',
            'Add butter, sugar to the shopping list'
        ]
        const expected = {
            '1': {
                "list": "shopping",
                "name": "bread",
                "is_completed": false
            },
            '2': {
                "list": "shopping",
                "name": "milk",
                "is_completed": false
            },
            '3': {
                "list": "shopping",
                "name": "cheese",
                "is_completed": false
            },
            '4': {
                "list": "shopping",
                "name": "butter",
                "is_completed": false
            },
            '5': {
                "list": "shopping",
                "name": "sugar",
                "is_completed": false
            }
        }
        await testExpressions(expressions)
        var list = createObjs()
        expect(JSON.stringify(list[1])).toBe(JSON.stringify(expected))

    })
    test('check off all elements in shopping list', async () => {
        const expressions = [
            'Check bread from my shopping list',
            'Check milk from the shopping list',
            'Complete cheese from the shopping list',
            'Tick butter, sugar from the shopping list'
        ]
        const expected = {
            '1': {
                "list": "shopping",
                "name": "bread",
                "is_completed": true
            },
            '2': {
                "list": "shopping",
                "name": "milk",
                "is_completed": true
            },
            '3': {
                "list": "shopping",
                "name": "cheese",
                "is_completed": true
            },
            '4': {
                "list": "shopping",
                "name": "butter",
                "is_completed": true
            },
            '5': {
                "list": "shopping",
                "name": "sugar",
                "is_completed": true
            }
        }
        await testExpressions(expressions)
        var list = createObjs()
        expect(JSON.stringify(list[1])).toBe(JSON.stringify(expected))

    })
    test('add item to school list then rename it', async () => {
        const expressions = [
            'Add cats to my school list',
            'Rename the school list to buy'
        ]
        const expectedTodo = {
            "list": "buy",
            "name": "cats",
            "is_completed": false
        }
        const expectedList = {
            "name": "buy"
        }
        await testExpressions(expressions)
        var list = createObjs()
        var todoVals = Object.values(list[1])
        var listVals = Object.values(list[0])
        var renameFlag = true
        var todoFlag = true
        listVals.forEach( obj => {
            if (obj.name == "school") renameFlag = false
        })
        todoVals.forEach( obj => {
            if (obj.name == "cats" && obj.list == "school") todoFlag = false
        })
        expect(renameFlag).toBe(true)
        expect(todoFlag).toBe(true)

    })
  
})


