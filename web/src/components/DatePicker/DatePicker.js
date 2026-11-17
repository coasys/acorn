import React, { useState, useEffect, useRef } from 'react'
import moment from 'moment'

import PickerTemplate from '../PickerTemplate/PickerTemplate'
import 'react-dates'
import { DateRangePicker, SingleDatePicker } from 'react-dates'
import { START_DATE } from 'react-dates/constants'
import 'react-dates/lib/css/_datepicker.css'
import 'react-dates/initialize'

import './DatePicker.scss'

function DatePicker({ date, onClose, onSet }) {
  // the value the picker opened with: submitting it back is not an edit
  const openedWith = useRef(date ? date.unix() : null)
  return (
    <PickerTemplate
      heading="Target Date"
      className="date_picker_wrapper"
      onClose={onClose}
    >
      <div className="date_picker_content">
        <SingleDatePicker
          // enable selecting dates in the past as well
          isOutsideRange={() => false}
          // highlight the current date, just for usability
          isDayHighlighted={(date) => {
            return date.isSame(moment(), 'date')
          }}
          keepOpenOnDateSelect
          reopenPickerOnClearDate
          showClearDate={true}
          customCloseIcon={<button className="clear-button">clear</button>}
          numberOfMonths={1}
          focused={true}
          onFocusChange={({ focused }) => {}}
          id="date_picker_id"
          date={date} // momentPropTypes.momentObj or null,
          onDateChange={(newDate) => {
            const next = newDate ? newDate.unix() : null
            onSet(next, next !== openedWith.current)
          }}
        />
      </div>
    </PickerTemplate>
  )
}

export { DatePicker }

function CustomDateRangePicker({ fromDate, toDate, onClose, onSet }) {
  const [dates, setDates] = useState({
    fromDate,
    toDate,
  })
  const [focusedInput, setFocusedInput] = useState(START_DATE)
  // the range the picker opened with: submitting it back is not an edit,
  // and mounting the picker is not a submit at all
  const openedWith = useRef({
    fromDate: fromDate ? fromDate.unix() : null,
    toDate: toDate ? toDate.unix() : null,
  })
  const mounted = useRef(false)

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    const from = dates.fromDate ? dates.fromDate.unix() : null
    const to = dates.toDate ? dates.toDate.unix() : null
    // a half-picked range (one date set, the other null) is a selection in
    // progress, not a value: submit only a complete range or the
    // both-null "clear all"
    if ((from == null) !== (to == null)) return
    onSet(
      from,
      to,
      from !== openedWith.current.fromDate ||
        to !== openedWith.current.toDate
    )
  }, [dates])

  return (
    <PickerTemplate
      heading="Time"
      className="date_picker_wrapper"
      onClose={onClose}
    >
      <div className="date_picker_content">
        <DateRangePicker
          // enable selecting dates in the past as well
          isOutsideRange={() => false}
          // highlight the current date, just for usability
          isDayHighlighted={(date) => {
            return date.isSame(moment(), 'date')
          }}
          numberOfMonths={1}
          minimumNights={0}
          onClose={() => {
            console.log('thinks Im closing')
          }}
          showClearDates
          keepOpenOnDateSelect
          reopenPickerOnClearDates
          customCloseIcon={<button className="clear-button">clear all</button>}
          startDate={dates.fromDate} // momentPropTypes.momentObj or null,
          startDateId="your_unique_start_date_id"
          endDate={dates.toDate} // momentPropTypes.momentObj or null,
          endDateId="your_unique_end_date_id"
          onDatesChange={({ startDate, endDate }) => {
            setDates({ fromDate: startDate, toDate: endDate })
          }}
          focusedInput={focusedInput}
          onFocusChange={(focusedInput) => {
            // doesn't update the focusedInput if it is trying to close the DRP
            if (!focusedInput) return
            setFocusedInput(focusedInput)
          }}
        />
      </div>
    </PickerTemplate>
  )
}

export default CustomDateRangePicker
