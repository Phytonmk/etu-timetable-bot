const fs = require('fs')
const axios = require('axios')
const JSON5 = require('json5')

const configs = require('./configs')
const timetable = require('./timetable')

let state = {lastUpdate: 0, lastSentMessageTime: 0}
if (fs.existsSync('./state.json'))
  state = require('./state.json')

const jsonToString = (obj) => {
  let cache = [];
  const result = JSON5.stringify(obj, (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (cache.indexOf(value) !== -1) {
        try {
          return JSON5.parse(JSON5.stringify(value))
        } catch (error) {
          return
        }
      }
      cache.push(value)
    }
    return value
  });
  cache = null
  return result
}

const getDate = () => new Date()//new Date('09-04-2018 12:15')

console.log('Date now', getDate())

const evenWeekCheck = (lesson) => {
  const firstSeptemberDate = new Date(`9-1-${(getDate().getFullYear())}`)
  const todayDate = getDate()
  const weeksFromFirstSeptember = Math.round((todayDate.getTime() - firstSeptemberDate.getTime()) / (1000 * 60 * 60 * 24 * 7))
  
  if (weeksFromFirstSeptember % 2 === 0 && lesson.notEveryWeek === 'only odds')
    return false
  if (weeksFromFirstSeptember % 2 === 1 && lesson.notEveryWeek === 'only evens')
    return false
  return true
}

const prettyDayTimetable = (timetable) => {
  let result = ''
  for (let lesson of timetable.lessons) {
    if (!evenWeekCheck(lesson))
      continue
    const startHour = lesson.start.substr(0, lesson.start.indexOf(':')) * 1
    const startMinute = lesson.start.substr(lesson.start.indexOf(':') + 1) * 1
    let endHour = startHour
    let endMinute = startMinute + lesson.duration
    while (endMinute >= 60) {
      endHour++
      endMinute -= 60
    }
    result += `${startHour >= 10 ? startHour : ('0' + startHour)}:${startMinute >= 10 ? startMinute : ('0' + startMinute)}`
    result += '-'
    result += `${endHour >= 10 ? endHour : ('0' + endHour)}:${endMinute >= 10 ? endMinute : ('0' + endMinute)}`
    result += ' '
    result += `<b>${lesson.title}</b>`
    if (lesson.type)
      result += ` (${lesson.type})`
    result += '\n'
    if (lesson.place)
      result += `<i>${typeof lesson.place === 'number' ? ('Аудитория ' + lesson.place) : lesson.place}</i>    `
    if (lesson.person)
      result += lesson.person
    if (lesson.person || lesson.place)
      result += '\n\n'
  }
  return result
}

const days = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница  🍻', 'Суббота']

const work = async () => {
  const thisDay = timetable.find(day => day.day === getDate().getDay())
  if (thisDay !== undefined && thisDay.lessons !== undefined) {
    if (Math.abs(getDate().getTime() - state.lastSentMessageTime) > 1000 * 60 * 30) {
      const allLessonsStart = []
      const daysWithLessons = []
      for (let day of timetable)
        daysWithLessons.push(day.day)
      for (let lesson of thisDay.lessons) {
        const startHour = lesson.start.substr(0, lesson.start.indexOf(':')) * 1
        const startMinute = lesson.start.substr(lesson.start.indexOf(':') + 1) * 1
        allLessonsStart.push(startHour * 60 + startMinute)
      }
      const now = getDate().getHours() * 60 + getDate().getMinutes()
      if (daysWithLessons.includes(getDate().getDay()) && Math.abs((allLessonsStart[0] - 90) - now) < 10) {
        let msgText = `Сегодня ${days[getDate().getDay()]} и через полтора часа начинается первая пара, а значит нужно потягивать лапки и собираться в вузик\n`
        if (getDate().getDay() === 1)  {
          msgText += 'А вот и расписание пар на эту неделю\n'
          msgText += `\n<code>================</code>\n`
          for (let day of timetable) {
            msgText += `<b>${days[day.day]}</b>\n`
            msgText += prettyDayTimetable(day)
            msgText += `<code>================</code>\n`
          }
        } else {
          msgText += 'А вот и расписание пар на сегодня\n\n'
          msgText += prettyDayTimetable(thisDay)
          msgText += `<code>================</code>\n`
        }
        await axios.post(`https://api.telegram.org/bot${configs.token}/sendMessage`, {
            chat_id: configs.group,
            text: msgText,
            parse_mode: 'HTML'
          })
        state.lastSentMessageTime = getDate().getTime()
        fs.writeFileSync('./state.json', JSON.stringify(state))
      }
      // console.log(allLessonsStart, now)
      for (let i in allLessonsStart) {
        const lessonStart = allLessonsStart[i]
        if (Math.abs(lessonStart - 5 - now) < 3) {
          const lesson = thisDay.lessons[i]
          if (!evenWeekCheck(lesson))
            continue
          let msgText = `Через пять минут начинается` +
            ` ${lesson.type ? lesson.type : (lesson.title.toLowerCase() !== 'физкультура' ? 'лекция' : 'занятие')}` + 
            ` по предмету\n<b>${lesson.title}</b>\n`
          if (lesson.place)
            msgText += `<i>${typeof lesson.place === 'number' ? ('Аудитория ' + lesson.place) : lesson.place}</i>    `
          if (lesson.person)
            msgText += lesson.person
          await axios.post(`https://api.telegram.org/bot${configs.token}/sendMessage`, {
              chat_id: configs.group,
              text: msgText,
              parse_mode: 'HTML'
            })
          state.lastSentMessageTime = getDate().getTime()
          fs.writeFileSync('./state.json', JSON.stringify(state))
          break
        }
      }
    }
  }

  const updates = await axios.get(`https://api.telegram.org/bot${configs.token}/GetUpdates?offset=${state.lastUpdate}`)
    .catch(console.log)
  if (updates && updates.data.result.length > 0) {
    state.lastUpdate = updates.data.result[updates.data.result.length - 1].update_id + 1
    fs.writeFileSync('./state.json', JSON.stringify(state))
  } else {
    return
  }
  console.log(updates)
  for (let update of updates.data.result) {
    if (update.message.chat.id === configs.group && update.message.text !== '/timetable')
      continue
    let msgText = `Сегодня <b>${days[getDate().getDay()]}</b>\n\n`
    msgText += '<b>Расписание на сегодня:</b>\n'
    if (thisDay === undefined)
      msgText += 'Отсутствует\n'
    else
      msgText += prettyDayTimetable(thisDay)
    msgText += `\n<code>================</code>\n`
    for (let day of timetable) {
      msgText += `<b>${days[day.day]}</b>\n`
      msgText += prettyDayTimetable(day)
      msgText += `<code>================</code>\n`
    }
    await axios.post(`https://api.telegram.org/bot${configs.token}/sendMessage`, {
        chat_id: update.message.chat.id,
        text: msgText,
        parse_mode: 'HTML'
      })
  }
} 
work()
setInterval(work, 10 * 1000)