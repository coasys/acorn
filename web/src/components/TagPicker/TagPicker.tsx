import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ActionHashB64, WithActionHash } from '../../types/shared'
import { Tag as TagType } from '../../types'
import Button from '../Button/Button'
import Checkbox from '../Checkbox/Checkbox'
import Icon from '../Icon/Icon'
import Tag from '../Tag/Tag'
import ValidatingFormInput from '../ValidatingFormInput/ValidatingFormInput'

import './TagPicker.scss'

// @ts-ignore
import PopupTriangleWhite from '../../images/popup-triangle-white.svg'

/** a tag selection is a set: order and array identity do not matter */
const sameTagSet = (a: ActionHashB64[], b: ActionHashB64[]) =>
  a.length === b.length && a.every((hash) => b.includes(hash))

export type TagPickerDisplayTagsProps = {
  tags: WithActionHash<TagType>[]
  selectedTags: ActionHashB64[]
  onToggleTag: (actionHash: ActionHashB64) => void
  filterText: string
  setFilterText: (text: string) => void
  setIsCreateOrEditTagOpen: React.Dispatch<React.SetStateAction<boolean>>
  setEditingTagID: React.Dispatch<React.SetStateAction<string>>
}

const TagPickerDisplayTags: React.FC<TagPickerDisplayTagsProps> = ({
  tags,
  selectedTags,
  onToggleTag,
  filterText,
  setFilterText,
  setIsCreateOrEditTagOpen,
  setEditingTagID,
}) => {
  return (
    <div className="tag-picker-display-tags-wrapper ">
      {/* search tag */}
      {tags.length > 0 && (
        <div className="tag-picker-filter">
          {/* @ts-ignore */}
          <Icon name="search.svg" size="small" className="grey not-hoverable" />
          <input
            type="text"
            onChange={(e) => setFilterText(e.target.value.toLowerCase())}
            value={filterText}
            placeholder="Search for a tag"
          />
          {filterText !== '' && (
            <div
              onClick={() => {
                setFilterText('')
              }}
              className="clear-button"
            >
              {/* @ts-ignore */}
              <Icon
                name="x.svg"
                size="small"
                className="light-grey not-hoverable"
                withTooltip
                tooltipText="Clear"
              />
            </div>
          )}
        </div>
      )}

      {/* Tags list */}
      <div className="tag-picker-list-wrapper">
        {tags
          .filter((tag) => {
            return filterText
              ? tag.text.toLowerCase().includes(filterText.toLowerCase())
              : true
          })
          .map((tag) => {
            const isChecked = selectedTags.includes(tag.actionHash)
            return (
              <div key={tag.actionHash} className="tag-picker-tag-option">
                <div
                  className="tag-picker-selectable-area"
                  onClick={() => onToggleTag(tag.actionHash)}
                >
                  <Checkbox size="small" isChecked={isChecked} />
                  <Tag text={tag.text} backgroundColor={tag.backgroundColor} />
                </div>
                <div
                  className="tag-picker-edit-button"
                  onClick={() => {
                    setIsCreateOrEditTagOpen(true)
                    setEditingTagID(tag.actionHash)
                  }}
                >
                  <Icon
                    name="edit.svg"
                    className="light-grey not-hoverable"
                    size="small"
                  />
                </div>
              </div>
            )
          })}
      </div>

      {/* Create  */}
      <div
        className="create-new-tag-button"
        onClick={() => setIsCreateOrEditTagOpen(true)}
      >
        <div className="create-new-tag-button-icons">
          {/* @ts-ignore */}
          <Icon name="plus.svg" className="grey not-hoverable" />
          {/* @ts-ignore */}
          <Icon name="tag.svg" className="grey not-hoverable" />
        </div>
        Create a new tag
      </div>
    </div>
  )
}

/*
  CreateOrEditTag Component
*/

export type CreateOrEditTagProps = {
  onCancel: () => void
  onSave: (text: string, color: string) => Promise<void>
  savedTagText?: string
  savedTagColor?: string
}

const CreateOrEditTag: React.FC<CreateOrEditTagProps> = ({
  onCancel,
  onSave,
  savedTagText,
  savedTagColor,
}) => {
  const [hasTypedText, setHasTypedText] = useState(false)
  const [hasTypedColor, setHasTypedColor] = useState(false)
  const [tagText, setTagText] = useState(savedTagText ? savedTagText : '')
  const DEFAULT_TAG_COLOR = '#1DA094'
  const [tagColor, setTagColor] = useState(
    savedTagColor ? savedTagColor : DEFAULT_TAG_COLOR
  )
  const [colorPickerOpen, setColorPickerOpen] = useState(false)

  // update the internal state based on any changes
  // to the external state
  useEffect(() => {
    setTagText(savedTagText)
  }, [savedTagText])
  useEffect(() => {
    if (savedTagColor) {
      setTagColor(savedTagColor)
    } else {
      setTagColor(DEFAULT_TAG_COLOR)
    }
  }, [savedTagColor])

  const tagTextValid = tagText.length > 0
  const tagColorValid = tagColor.length > 0 && tagColor[0] === '#'
  const onClickSave = async () => {
    if (tagTextValid && tagColorValid) {
      return onSave(tagText, tagColor)
    }
  }

  // List of color swatches
  const colorList = [
    '#1DA094',
    '#103BB1',
    '#A0871D',
    '#4A1DA0',
    //
    '#104540',
    '#911DA0',
    '#447C21',
    '#A01D27',
    //
    '#2B7691',
    '#B45C11',
    '#60B10F',
    '#E27213',
    //
    '#ED868A',
    '#23CBBE',
    '#230EC7',
    '#E2BA13',
  ]

  return (
    <div className="create-or-edit-tag-wrapper">
      <div>
        {/* @ts-ignore */}
        <ValidatingFormInput
          value={tagText}
          onChange={(text: string) => {
            setHasTypedText(true)
            setTagText(text)
          }}
          invalidInput={hasTypedText && tagTextValid}
          validInput={tagTextValid}
          errorText={
            hasTypedText && !tagTextValid ? 'A label is required.' : ''
          }
          label="Label"
          placeholder="Release 0.6.2"
        />
        <div className="tag-picker-color-row">
          {/* @ts-ignore */}
          <ValidatingFormInput
            value={tagColor}
            onChange={(color: string) => {
              setHasTypedColor(true)
              setTagColor(color)
            }}
            invalidInput={hasTypedColor && !tagColorValid}
            validInput={tagColorValid}
            errorText={
              hasTypedColor && !tagColorValid
                ? 'A valid hex code is required.'
                : ''
            }
            label="Color"
            placeholder="#1DA094"
          />
          <div className="create-or-edit-tag-color-display-wrapper">
            {/* display color */}
            <div
              onClick={() => setColorPickerOpen(!colorPickerOpen)}
              className="create-or-edit-tag-color-swatch"
              style={{ backgroundColor: tagColor }}
            />
            {/* allow color changing */}
            {colorPickerOpen && (
              <div className="create-or-edit-tag-colors-wrapper">
                <img className="popup-triangle" src={PopupTriangleWhite} />
                {/* render each pre-defined color swatch from the list */}
                {colorList.map((colorPreset, index) => {
                  if (!colorList.includes(tagColor) && index === 0) {
                    colorPreset = tagColor
                  }
                  const isSelectedColor = tagColor === colorPreset
                  return (
                    <div
                      className={`create-or-edit-tag-color-swatch ${
                        isSelectedColor ? 'selected' : ''
                      }`}
                      style={{ backgroundColor: colorPreset }}
                      onClick={() => {
                        setTagColor(colorPreset)
                        setColorPickerOpen(false)
                      }}
                    >
                      {/* show a white check icon on the selected tag color swatch */}
                      {isSelectedColor && (
                        <Icon
                          name="check.svg"
                          size="small"
                          className="white not-hoverable"
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
      {/* create or edit tag buttons */}
      <div className="create-or-edit-tag-buttons">
        <Button text="Cancel" onClick={onCancel} size={'small'} secondary />
        <Button
          text="Save Changes"
          onClick={onClickSave}
          size={'small'}
          disabled={!tagColorValid || !tagTextValid}
        />
      </div>
    </div>
  )
}

/*

TagPicker default export Component

*/

export type TagPickerProps = {
  tags: WithActionHash<TagType>[]
  selectedTags: ActionHashB64[]
  onChange: (
    newSelectedTags: ActionHashB64[],
    previousSelectedTags?: ActionHashB64[]
  ) => void
  filterText: string
  setFilterText: (text: string) => void
  onCreateTag: (text: string, backgroundColor: string) => Promise<void>
  onUpdateExistingTag: (
    actionHash: ActionHashB64,
    text: string,
    backgroundColor: string
  ) => Promise<void>
  onClose: () => void
}

const TagPicker: React.FC<TagPickerProps> = ({
  tags,
  selectedTags,
  onChange,
  filterText,
  setFilterText,
  onCreateTag,
  onUpdateExistingTag,
  onClose,
}) => {
  // if there aren't any tags, then it should
  // be open to the create tag panel by default
  const [isCreateOrEditTagOpen, setIsCreateOrEditTagOpen] = useState(
    !tags.length
  )

  // existing tag ID that is being edited
  const [editingTagID, setEditingTagID] = useState('')

  /* A selection can outpace its prop: an onChange's write comes back as a
     new selectedTags only after the save round-trips. Until it does, the
     next toggle must build on the last submitted list, not the rendered
     one — otherwise two clicks inside one round trip lose the first. The
     ref is the event-order authority (two callbacks inside one batched
     render cannot both read a state update); pendingList mirrors it so
     optimistic checkmarks render. submitted keeps every list sent but not
     yet seen back as props, oldest first; pending is always its newest
     entry. */
  const selectionRef = useRef<{
    lastProps: ActionHashB64[]
    pending: ActionHashB64[] | null
    submitted: ActionHashB64[][]
  } | null>(null)
  if (selectionRef.current === null) {
    selectionRef.current = {
      lastProps: [...selectedTags],
      pending: null,
      submitted: [],
    }
  }
  const selection = selectionRef.current
  const [pendingList, setPendingList] = useState<ActionHashB64[] | null>(null)

  /* Reconcile the ref with the rendered props. A prop list whose contents
     moved is not necessarily a peer change: the picker's own writes echo
     back the same way, one list at a time. If the arriving list is one of
     the submitted ones, it is an echo — drop it and the older lists
     (writes land in order), keeping pending unless the newest submission
     itself just landed. A list matching nothing this picker sent is a
     peer change and wins: pending and submitted both clear. An identical
     set on a new array, or an unrelated rerender, retains pending. */
  const reconcileProps = (props: ActionHashB64[]) => {
    if (sameTagSet(props, selection.lastProps)) return
    selection.lastProps = [...props]
    const echoed = selection.submitted.findIndex((list) =>
      sameTagSet(list, props)
    )
    if (echoed >= 0) {
      selection.submitted = selection.submitted.slice(echoed + 1)
      if (!selection.submitted.length) {
        selection.pending = null
        setPendingList(null)
      }
      return
    }
    selection.submitted = []
    if (selection.pending !== null) {
      selection.pending = null
      setPendingList(null)
    }
  }
  useLayoutEffect(() => {
    reconcileProps(selectedTags)
  })

  const onToggleTag = (actionHash: ActionHashB64) => {
    // reconcile here too, so a props update React committed but whose
    // effect has not run yet cannot leave a stale pending list behind
    reconcileProps(selectedTags)
    const base = selection.pending ?? selectedTags
    const next = base.includes(actionHash)
      ? base.filter((hash) => hash !== actionHash)
      : [...base, actionHash]
    // a no-op selection submits nothing
    if (sameTagSet(next, base)) return
    selection.pending = next
    selection.submitted.push(next)
    setPendingList([...next])
    onChange([...next], [...base])
  }
  const effectiveSelectedTags = pendingList ?? selectedTags

  const onClickSaveTag = async (text: string, backgroundColor: string) => {
    if (editingTagID) {
      // if updating a tag
      await onUpdateExistingTag(editingTagID, text, backgroundColor)
    } else {
      // if creating a new tag
      await onCreateTag(text, backgroundColor)
    }
    setIsCreateOrEditTagOpen(false)
    setEditingTagID('')
  }

  // to define an existing tag being edited
  const tagBeingEdited = editingTagID
    ? tags.find((tag) => tag.actionHash === editingTagID)
    : null
  const selectedTagText = tagBeingEdited ? tagBeingEdited.text : ''
  const selectedTagColor = tagBeingEdited ? tagBeingEdited.backgroundColor : ''

  return (
    <div className="tag-picker-wrapper">
      {!isCreateOrEditTagOpen && (
        <TagPickerDisplayTags
          tags={tags}
          selectedTags={effectiveSelectedTags}
          setEditingTagID={setEditingTagID}
          onToggleTag={onToggleTag}
          filterText={filterText}
          setFilterText={setFilterText}
          setIsCreateOrEditTagOpen={setIsCreateOrEditTagOpen}
        />
      )}
      {isCreateOrEditTagOpen && (
        <CreateOrEditTag
          savedTagText={selectedTagText}
          savedTagColor={selectedTagColor}
          onCancel={() => {
            if (tags.length) {
              setIsCreateOrEditTagOpen(false)
              setEditingTagID('')
            } else {
              onClose()
            }
          }}
          onSave={onClickSaveTag}
        />
      )}
    </div>
  )
}

export default TagPicker
