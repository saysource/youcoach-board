# YouCoach Board

YouCoach Board is a graphical application to design drills and tactics, specifically design at this point for soccer, but in the future may be configured for other sports.
It allows the user to place and animate a variety of figures and shapes on an SVG canvas.

YouCoach Board is fully embeddable react based app, able to work as a standalone tool and as an embeddable tool (like a regular react component), to design drawings.
 
The most important use cases are:
- design drawings inside YouCoach App, a completely separated react application
- inside Youcoach Video Analysis, a completely separated react application
- inside the youcoach website (Drupal) where non-react javascript should able to use it as “viewer/player”
= independent tool hosted on a specific website (i.e. board.youcoach.ai)
- embeddable in an html page to be used as plain viewer for a provided drawing/animation

The drawings are loaded and saved as JSON. An entire chapter of these specs is dedicated to the details of the v1 of the JSON format.

This project is a full rewrite of this jquery based application:
@/Users/gtoffoli/Saysource/progetti/Youcoach/GIT/yceditor

On top of the capabilities offered by the old application, we will introduce new functionalities, such as easing for animations and new types of elements, features that have been implemented at some degree in YouCoach Video Analysis, a different React application which is part of the tools of the YouCoach family: in particular we will borrow the ability to easily create effects (for animating entering and exiting elements) and the element Arrow 3D.
Here are the relevant folders to check about these features:
@/Users/gtoffoli/Saysource/progetti/Youcoach/GIT/youcoachvideo/client/src/presentation/canvas/Layer3D.tsx
@/Users/gtoffoli/Saysource/progetti/Youcoach/GIT/youcoachvideo/client/src/presentation/figures/effects

A generic javascript API should allow us to load and read the current JSON model.

The rewrite will be fully insipired to the minimalism usability of Excalidraw (https://github.com/excalidraw/excalidraw).

Main features:

- Minimalistic UI, mostly floaring toolbars and a sidenbase visible on demand with libraries of pre-built objects.
- Undo redo stack management
- Multiple selection
- Scale, move, rotate elements
- Keyframe based animation with properties interpolation
- Editable background (selectable background svg image that can be scaled and moved to adjust its position)
- Ability to manage text elements with wrapping box
- Ability to add hand-drawn elements
- Ability to export the entire drill as image
- Ability to export the animation as video mp4
- Ability to load/save in a given JSON format


## Technologies

This project will use:

- React
- Shadcn for UI elements
- Motion for animations
- Zustand for state management
- Tailwind for styling
= Licide icons + custom icons

All these technologies are used already in YouCoach App 2 at @/Users/gtoffoli/Saysource/progetti/Youcoach/GIT/youcoachapp2/client from which we should get the tailwind.css customizations for dark and light mode.

## Main UI

The main UI is a container with an always visible floating toolbar.
In the center we will have a canvas.

Other floating buttons will allow to access a main menu for loading/saving JSON files, a mini toolbar to manage zoom, a mini toolbar to manage undo/redo, a button to open a right side drawer with figures library, a button to go full viewport size for when the component is embedded in another app and other pluggable buttons.

### Canvas technology (decided): SVG for editing, canvas for export

The drawable area is a fixed-ratio board (not an infinite whiteboard), with at
most tens of elements on screen — never hundreds. Given that, the interactive
board is **SVG**, not an HTMLCanvas. The reasoning:

- The figures are themselves SVG assets, and field backgrounds need
  user-configurable colors — both are native in SVG (bind `fill` to attributes /
  CSS vars) and awkward on a canvas.
- Selection, multi-select, move/scale/rotate and hit-testing come for free from
  the DOM instead of being reimplemented.
- Animation is declarative through Motion (it animates SVG attributes/transforms
  directly) rather than an imperative rAF loop.
- At our element count, canvas's only real advantage (raw throughput) does not
  apply. Excalidraw uses a canvas because it is a *general, infinite* whiteboard
  optimizing for arbitrary element counts; our problem is different.

The board is a **layer sandwich**:

1. **2D layer — SVG**: background field + figures + path shapes + text. The
   editable core.
2. **3D overlay — WebGL canvas** (three.js): the Arrow 3D element. This is WebGL
   regardless of the 2D choice, so it sits on its own layer.
3. **Export — offscreen canvas**: composites a rasterized snapshot of the SVG
   layer with the WebGL layer's pixels.

Export paths:

- **Image**: serialize the SVG → draw into an offscreen `<canvas>` → `toBlob`.
- **Video (mp4)**: drive the animation deterministically frame-by-frame,
  rasterize each SVG frame to the offscreen canvas, encode via `MediaRecorder`
  (`captureStream`) or `ffmpeg.wasm`.

Two discipline rules keep export reliable (both are easy to break accidentally):

- **No `<foreignObject>` in the rendered/exported tree.** Browsers do not
  reliably rasterize it to canvas. In particular, text wrapping must be laid out
  into `<tspan>` lines via a measure-and-break pass — an HTML overlay may be used
  *only* during active text editing, then committed to tspans.
- **The exported SVG must be self-contained**: inline (not externally
  referenced) figure assets, fonts embedded or pre-measured.

## Look and feel

The app will support light and dark mode. It should be possible to enforce the mode from outside the component when the component is embedded.

## Phase 1:

Create the very initial UI with the main canvas, the main tool bar, the drawer (empty), the main top/left dropdown menu, the zoom bar, the undo/redo bar (all not operational) except for the "resize to fill the viewport icon".


## Phase 2: Minimal designer

In this phase we want to create the initial skeleton of the designer.
The designer will allow to create three types of figures:

- rectangle
- circle/ellipse
- streight line

### Basic features

- Activation of a creation tool (rectangle, circle, line)
- Figure creation: Ability to create a circle/ellispe, a line and a rectangle
- Basic figure selection: be able to select a figure

When the tool is active, the user can click and drag the mouse to draw the rectangle/circle/line by essentially click a point and move to pointer. Once released this will be the bounding box of the new figure. The figure is painted while the pointer drag.
For now just use static properties:
- transparent fill
- stroke 3 px black

Once the figure is created, the selected creation tool automatically deactivates, to activate the selection tool.

In order to select a figure, we need to click on the figure.

A selected figure shows a frame corresponding to its bounding box.

Clicking elsewhere the figure is deselected.

## Undo/Redo stack

We want to draft from the start the undo/redo management. There are many way to manage undo/redo, my suggestion is to implement a stack management similar to the one created for YouCoach Video Analysis which was implemented using redux and thunks, but this is just a detail.

- each operation performed on the model can be undone and redone
- instead of a copy of the model, we store the relevant operation data to be able to undo and redo that operation
- changes are performed only be means of operations that can operate on one or more figures and on one or more attributes, the operation knows how to apply a set of changes
- operations can be grouped to form an atomic operation (useful to define an operation as sequence of multiple other operations)

To have a clear idea of how it is implemented, check:
@/Users/gtoffoli/Saysource/progetti/Youcoach/GIT/youcoachvideo/client/src/features/presentation/presentationUndoReduThunks.ts
and relevant files in the same folder.

## Selection figures and handles

Pretty much all the objects use a rectangle which covers the element bounding box, with 4 handles for resize in different directions as selection.
To this rectangle we want to add a 5th handle for rotation, a circle on top. Something cool that excalidraw does is rotating the little square of the for corners of the selection figure to stay always at zero degrees, we may want it too.

An exception is represented by lines (and arrows which are just lines with one or two tips). In that case we want to show only a circular handle at the extremes of the line.

When we will introduce pre-build svg based figure, we will keep the ratio of resized figure, actually scaling it.
The same will be for text.


## Implement resize

All figure showing the 4 handles can be resized. Please note that shapes (rectangle, circe, closed polylines) should not scale when resized, but the points needs to be recalculated.
In case of complex figures (pre-made svg based figures) the element will keep its proportion (but we still don't have this type of figures).
Also implement rotation for figures supporting it (which are all )

## Canvas bounds

elements can be moved and resize freely, but a piece of the figure should always remain inside the canvas, otherwise the user would loose that element, and we want prevent that. Also the elements (maybe not the selection frames) should not overflow the canvas size when drawn. It would probably be good to mark the border of the canvas (ligth 0.4 opacity kind of border, not rounded).

## Polyline

We want to implement a polyline element, which can be either closed or not.
While creating the polyline, the user will click different points on the canvas.
The first and the last points will have a circle. If the user click on one of the two circles (with a bounce animation of the circle on enter with the pointer), the line will end.
If the user press ESC, the line ends open.


# Elements

Elements can be divided in the following main categories:

Figures (like players, materials shapes like ball or cones), and everything that can simply be moved, resized (scaled), rotated 
Path based figures: figures that are defined by a set of points (circle, rectangle, ellipsis, arrows)
3D arrows, managed in an overlay layer with three.js, this very special element type will be implemented based on the same element created for youcoach VA. 


# SVG Figures

SVG figures are figures based on an SVG, which can be added to the drill drawing, the user can proportionally scale, move, rotate that element. The figures a divided in categories and subcategories, defined in YCEditor.prototype.palette_categorie, which is a structure primarily defined for the overall structure of the visual palette, and include categories that are not fixed SVG figures such as the shapes and the fields.

YCEditor.prototype.palette_categorie in @/Users/gtoffoli/Saysource/progetti/Youcoach/GIT/yceditor/js/src/ycdrilleditor.palette.figures.js 

{ label: "Players", 
              options: [
                { name: "players", label: "Players (Male)" },
                { name: "players_female", label: "Players (Female)" },
                { name: "goalkeepers", label: "Goalkeepers (Male)" },
                { name: "goalkeepers_female", label: "Goalkeepers (Female)" },
                { name: "futsal", label: "Futsal" },
                { name: "coaches", label: "Coaches" },
                { name: "referees", label: "Referees" },
                { name: "children", label: "Children" },
                { name: "preparation", label: "Preparation (Male)" },
                { name: "preparation_female", label: "Preparation (Female)" },
                { name: "players_top", label: "Players (from top)" } ]
            },
            { label: "Materials",
              options: [
                { name: "materials", label: "Materials" },
                { name: "discs", label: "Text and Numbers" },
                { name: "shapes", label: "Arrows and Shapes" } ]
            },
            { label: "Fields",
              options: [
                { name: "fields_11", label: "Fields 11" },
                { name: "fields_futsal", label: "Futsal" } ]
            }

## Background and Field SVGs

The canvas background can be configured to use a solid color or a predefined field background image (which resembles simple grass). The background may also overlay to the solid color or the image an SVG that represents a field or part of a field. If the selected SVG for the background does “declare” configurable colors, the user should be able to set these colors. This is the case, for instance, of futsal fields, where the user can set the two colors for the actual floor.
The SVG of the background can be scaled and moved, so the user can use a specific part of the field instead of the whole field represented by the SVG.
Field SVGs are grouped in Field 11 (Soccer field typical for 11vs11) and Futsal fields.


## The OLD model

In this paragraph we will see how the old model (JSON) was organized.
We don't have to stick to this model, definitively it needs to be extended, but it is a good start.

The file @specs/sample_old_json.json contains all the type of object we do support. Figures like the player (images/optimized/players/152.svg) and the ball (images/optimized/materials/15.svg) are imported SVG from a repository that depends by the the tool configuration, in other words these resources are served as statis resources.
Currently all the resources are located in @/Users/gtoffoli/Saysource/progetti/Youcoach/GIT/yceditor/images/optimized/. For each type of figure we have a thumbnail (png) and the actual SVG file.


## Properties panel and responsive design

Let's work on the properties panel, which should show up when an element is selected.
The properties panel allows to set element properties, suche as background color, stroke, stroke width, opacity, etc.

Excalidraw does an incredible job in terms of responsive design, both for what concerns the properties panel and the overall economic of the toobars.

In this task we will create the properties panel. We will just handle the following element properties:

- background color (for closed shapes)
- stroke color
- Stroke width and style
- Opacity

The properties panel should show when an element is selected.

On container >= 1180px, like Excalidraw does, we want to show a full panel.
On container < 1180, the panel becomes a vertical toolbar which group properties in a limited set accessed via a button:
 - background color (for closed shapes)
 - stroke color
 - settings (which opens a full panel with the main settings)
 - other operations usually shown at the bottom of the panel

On container < 768, we enter some sort of mobile mode: the toolbar goes to the bottom with a smaller set of operations and smaller icons,  just on top of this main toolbar, are shown the buttons to access the main properties of the element, instead of using the vertical toolbar, also on the right are shown the undo/redo buttons and the copy and delete icons, useful when no right click or keyboard is available.

Implement this logic, leaving icons for which we still don't have requirements inactive.

We will refine later all the individual properties we want to show in the properties panel and how to group them.


- Add a separator after the Selection tool
- replace the text tool icon with the PlayersIcon available here @/Users/gtoffoli/Saysource/progetti/Youcoach/GIT/youcoachapp2/client/src/core/components/season-dashboard/icons.tsx
- replace the image icon with the TrainingIcon available here @/Users/gtoffoli/Saysource/progetti/Youcoach/GIT/youcoachapp2/client/src/core/components/season-dashboard/icons.tsx
- Add a separator before the erase icon

- The more tools icon should show a dropdown menu with the following items

- Players (with the PlayersIcon)
- Materials (with the TrainingIcon)
- Shapes (with the icon defined here @assets/shapes.svg , which must be trasfromed in a Lucide kind of icon)
- Arrows (Lucide move-right icon)
- Discs (with the icon defined here @assets/disc.svg , which must be trasfromed in a Lucide kind of icon)
- a divider
- Background (with the Soccer field icon available here: @/Users/gtoffoli/Saysource/progetti/Youcoach/GIT/youcoachapp2/client/src/core/components/icons/SoccerFieldIcon.tsx )


All icons are not operative right now.

## The drawer content

In the drawer, remove the search and add a button which uses as a label the current selected category.
By default, the selected category is "Players (Male)".
When the button is pressed, we show under the button the full list of categories with the macro-category titles:

- Players
  - Players (Male)
  - Players (Female)
  - Goalkeepers (Male)
  - Goalkeepers (Female)
  - Futsal
  - Coaches
  - Referees
  - Children
  - Preparation (Male)
  - Preparation (Female)
  - Players (from top)
- Materials
  - Materials
  - Text and Numbers
  - Arrows and Shapes
- Fields and Background
  - Fields 11
  - Futsal

By clicking on a category, we show all the available element for that category.
We still need to define what to show in each category, for now use an empty div.



## TODO
- arrow 3D
- JSON export/import
- laser pointer
- presentation mode
- Import image (where to save it?)
- export image
- animation mode
- mini-tool help
- keyboard shortcuts
- i18n
- favorites figures
- multiline point dragging align with other points.


## Properties element by element

- Rectangle and ellipse
  - fill color
  - stroke color (with opacity)
  - stroke style (thin / medium / think)
  - opacity (overall opacity)
  - Special actions: Lock proportions

- Line 
  - fill color (if closed)
  - stroke color (with opacity)
  - stroke style (thin / medium / think)
  - opacity (overall opacity)
  - start tip (none / arrow / circle)
  - end tip (none / arrow / circle)
  - style (solid / dashed / dotted)
  - type (streight / quadratic bezier / cubic bezier)
  - Special actions: open / close, if the line has more than 3 points

- Player
  - kit config
  - skin config
  - opacity
  - scale (the default value of the scale may be tied to the type of field we are working with)
  - Special actions: flip horizontally, copy style (for kit and skin)

- Material
  - color (apply only to selected materials)
  - scale (the default value of the scale may be tied to the type of field we are working with)
  - Special actions: flip horizontally
  
- Text
  - text color (with opacity)
  - fill color (with opacity)
  - text padding
  - opacity (overall opacity)
  - text (it must support multiline text)

- Disc
  - color1 (with opacity), by default used for the center of the disc
  - color2 (with opacity), by default the ring color
  - disc style (disc / tshirt)
  - opacity (overall opacity)
  - text (single line)

## Color picker

Avoid using the browser default color picker, instead use the react-colorful and includes opacity information in stroke and fill colors.
We also want to provide the ability for the user to use the color picker tool.
The proposed 5 colors shown when editing the fill color should remember the last selection, with a FIFO strategy.
The same for stroke and text colors.

## Remembering color and styles

Once an element is selected, we keep its attributes as default values for the next creatio of element of the same category (fill, stroke, kit, skin, opacity, styles).


## Copy and paste

Implement copy and paste, when one or more elements are selected.

## Background editing mode

If the user select a Field from the palette either by dragging or clicking, we show as background SVG the selected SVG.
The very bottom of the background is our default field0 image. The user can modify the background SVG by enable "Edit background" which will show a 


## SVG player and figures

All the SVG are made of paths, some of which are clearly marked with a special class name to be dinamycally coloured.
The classes are:

- yc-hair
- yc-skin
- base_tshirt
- shorts
- socks
- v_stripe
- h_stripe

For materials:

- yc-color-1
- yc-color-2



Kicking
Running
Standing
Throw In
Special
Dribbling
Pass




Now that the drawer is ready, enable the items in the More Tools dropdown in the main toolbar.
In that menu we show as first items all the main categories.

When the user clicks on the category we open the drawer (if closed or not pinned) and move to the selected category.

The Background menu point to the Fields category: we want to call it background because we will activate a special "mode" to show in the properties the background settings/properties when the fields category is activated.


Under the list of categories, after a separator, we want to also the following actions/shortcuts:
- Add Ball (with the MatchIcon from @/Users/gtoffoli/Saysource/progetti/Youcoach/GIT/youcoachapp2/client/src/core/components/season-dashboard/icons.tsx )
- Add Text

The shortcuts will add a ball (the first item of the materials with action "material.balls").
Since the ball will have a special treatment when we will work on animantions, we want to flag the fact that a figure element is a ball in our model.


## Background Settings

While Field 11 and Futsal are actually two distinct categories, we may want to show them as both independent categories we may consider to add a virtual category All Fields, which will treat Field 11 and Futsal as subcategories/actions. This is to simplify the next step in which, we want to choose a background quickly by showing the drawer, without having the user to guess that for futsal it needs to change category.

Change the More tools menu item "Background" in "Edit Background" and move it as last option in the current menu, with a separator.
When the user clicks on Edit background we will show the All fields category

When one of the categories of the fields macro-category is selected (which is all categories of kind "field"), 

When a field category is selected, in the properties panel we show:

- the ability to select a solid background and its color
- the ability to scale the SVG representing the field
- the ability to pan the SVG by showing the svg @assets/move_background.svg on top of the canvas
- select a logo position

The logo position refer to the position of the youcoach logo @/Users/gtoffoli/Saysource/progetti/Youcoach/GIT/youcoachapp2/client/src/core/assets/youcoachapp_logo_dark.svg shown on top of the background image with 0.2 opacity.
The positions are: center / top-left / top-right / bottom-left / bottom-right

------------

## Shapes menu

The Rectangle tool menu item in the main toolbar should become a more generic Shapes menu.
The default icon should be @assets/shapes.svg, which is what is used when no previous shape tool was selected.
The icon opens a drop down with the following shapes:
- Rectangle
- Ellipse
- Diamond
- Penthagon
- Triangle
- Trapezoid

As the user select a shape type, this becomes the selected tool, and in the main toolbar we replace the generic Shapes icon with the one of the selected tool.
If the user, upon opening the dropdown, does not make any choice, we activate automatically the last shape tool used, and the menu closes automatically by clicking outside it.
I provided the icon for @assets/shapes.svg, the only one missing.


## Arrows menu

The Arrow tool menu item in the main toolbar should become a more generic Lines menu.
The default icon should be @assets/lines.svg, which is what is used when no previous line/arrow tool was selected.
The icon opens a drop down with the following shapes:

- Arrow
- Line
- Elbow arrow (really a cubic bezier)
- Elbow line

As the user select a line/arrow type, this becomes the selected tool, and in the main toolbar we replace the generic Lines icon with the one of the selected tool.
If the user, upon opening the dropdown, does not make any choice, we activate automatically the last line tool used, and the menu closes automatically by clicking outside it.

### More about lines and arrow

Line/Arrow style can be of 2 types: streight or curved.
The tool Miro does a great job in siplyfing how the user can adjust the curve and adding/removing points to a ployline.
It shows between points special mid-points (let's call them anchors).
If the line is "streight", dragging an anchor will actually split the segment in two sub-segments.
If the line is "curved", bezier is automatically calculated between points, and dragging an anchor will add new curve point.
Double clicking a point (except for last and first) will remove that pont/joint.


The options for the line style are actually 3: simple, quadratic bezier and cubic bezier, but simple simply means that we use a quadratic with no curve.

If a line/arrow is composed of multiple segments, the bezier handles 


## Properties panel / properties bar

We want to drop the full panel view for the properties and stick with the minimal properties toolbar.
The properties toolbar will contain a set of icons/buttons.
By clicking the button, we will open a dropdown panel/widget with which settings can be easily modified.

The main widgets:
- background (applies to rectangle, ellipse, closed polylines and text pillow), it is represented in the toolbar by a circle coloured with the selected color, checkerboard background for opacity clarity and filled with the selected fill style; the opened widget shows:
  - fill style: solid / diagonal rows
  - color picker (more about the color picker later)
- border color show simply the color picker
- other props (settings icon): show properties specific to each element type:
  - stroke thick
  - stroke style
  - line style: streight or curved (icons strip to change the value)
  - arrow heades: two dropdowns, one for end, one for start, showing the options none, circe, arrow tip
  - close path: single toggle button ( @assets/close_path.svg)
  - font size (text elements)
  - padding (text elements)
  - opacity (global figure opacity)

- Kit and skin options (for later)
  - kit config
  - skin config
- Actions: a three dots icon to open a dropdown menu with several options:
  - Copy
  - Duplicate
  - Flip (only for SVG figures)
  - Arrange
    - Bring forward
    - Bring to Front
    - Send backword
    - Send to back
  - Copy style (included kit and skin config in case of players)
  - Paste style


### Properties element by element

- Rectangle and ellipse
  - fill color
  - stroke color (with opacity)
  - stroke thickness (thin / medium / think)
  - stroke style (thin / medium / think)
  - opacity (global figure opacity)

- Line 
  - fill color (if closed)
  - stroke color (with opacity)
  - stroke style (thin / medium / think)
  - opacity (overall opacity)
  - start tip (none / arrow / circle)
  - end tip (none / arrow / circle)
  - style (solid / dashed / dotted)
  - type (streight / quadratic bezier / cubic bezier)

- Player
  - kit config
  - skin config
  - opacity

- Material
  - color (apply only to selected materials)
  - scale (the default value of the scale may be tied to the type of field we are working with)
  
- Text
  - text color (with opacity)
  - fill color (with opacity)
  - text padding
  - opacity (overall opacity)

- Disc
  - color1 (with opacity), uses the border color type of button/widget
  - color2 (with opacity), uses the border color type of button/widget
  - disc style (disc / tshirt)
  - opacity (overall opacity)

- Materials
  - color1 (with opacity)
  - color2 (with opacity)
  - disc style (disc / tshirt)
  - opacity (overall opacity)


### Color picker widget

The color picker widget is composed by two parts:
a set of 5 colors the user can choose from, shown as rounded rectangles.
The first color should be always the fully transparent one, and then a list of preset colors, which are replaced with the last selected colors based on the property being edited (border/text, color 1 and 2, background), with a FIFO strategy.
A color picker widget which allows to specify a color in format of hex code, and the picker pen, as implemented here: @/Users/gtoffoli/Saysource/progetti/Youcoach/GIT/youcoachapp2/client/src/core/components/ui/color-picker.tsx
This color picker uses a drowpdown react-colorful dropdown, in our case the dropdown will show just the simple react-colorful colorpicker component, included opacity slider.

### More about Disc and disc style

For now we have a single type of disc, which is driven by the catalog. We will add other disc styles and maybe create an ad hoc editor for it like we will do for the player kit and skin/hairs.
Ignore it for now by providing a single option.


## Zigzag lines

Implement the line syile "Zigzag". The line will work like a curved line (bezier), but the actual line is rendered as zigzag curve along the main path based on two parameters:
- frequency
- amplitude

The editig should be similar to a regular curved line, with the same logic for the anchor points.

Zigzag will be a third line style, with icon @assets/line_style_zigzag.zvg

## Double lines

A double line is our forth type of line style. Like the zigzag, it is based on a curved line (bezier) and it renders two parallel lines equally distant from the reference path.
The distance between the two lines will be governed by the property lines offset (from 10 to 100).


- Add an action to the context menu to transform a rectangle to a polyline.

## Text elements

Text elements show a text on the canvas. The text should support multiline.
The text is wrapped by a rounded rectangle, which can eventually be transparent, having 5px pad.
In the properties panel we present:
- Text Color (similar to stroke color widget) default should be black-
- Background Color (we can use the background widget), without the background style, just the color and opacity
- Text Setting
- Font size (slider from 2 to 200)
- text alignment (default center, useful only where there are multiple lines)

On double click on the element, the user should be able to edit the text. Enter should be accepted as characted. The start of the text editing starts and undo transaction, which is closed on blur of the inline fully transparent textarea used for the editing of the text.
When editing, we we want to have the feeling of editing the SVG. The inline editing 

The background rounded rectangle should be calculated accordingli to the text bbox with a min width and height to fit the M character.
 



## Background Editig

So far we show the handle to move the background and the background properties panel when the we show the fields category in the drawer.
Centering (or moving) the background should be a clear state of the editor that disable all the other actions and shold be committed somehow.
Here is the idea

The background toolbar should be shown upon clicking edit background and we enter the edit background mode, showing the arrows indicating the possibility to move the background.

In the toolbar we show
- background color icon, which would open a color picker with the default colors we provide for the background
- the settings icon to edit scale and logo position
- a reset background icon

- In background edit mode, the drawer only show fields categories
- The main toolbar will show just a button "Finish editing background" (or something similar) which will allow to exit the background mode.

At any time, by pressing, ESC we will exit the background editing mode.

The arrows icon shown in the canvas to move the background should be bigger.


- When we create a new token, if a token is present on the board, we want to use the same size, if not present, we want to honour the selected backgorund scale.

## Materials

Materials can have 0 or 1 custom color. The color needs to be applied as fill to SVGElements with the class yc-color-1.

When a material is selected, in the properties toolbar show a single color selector (sililar to the background). For materials, the color should not have opacity.

Not all the materials use this custom color, we may consider to mark in our catalog which elements actually make use of it. This would involve in look for the presence of yc-color-1 in the svg withing the @packages/designer/public/images/optimized/materials path (a grep command could be enough).

## Player settings

Players can be customized by changing the appearance of kit and skin/hair.


In the toolbar, we show for player elements only the settings icon, which will contain:

The skin preview icon, which, on click will show the skin editor.
The kit preview icon, which on click will show the kit editor.

Both are shown next to each other.

Under them, we show the opacity slider.

### Skin editor

I prepared an SVG that represents a face at @assets/face.svg
This SVG contains 3 path, one is used for the main figure, the other two have id "skin" and "hair".
By setting the fill of skin and hair paths, we can effectivaly dynamically change the color of skin and hair.

We will store two values;
- skin color
- hair color

The editor is shown by pressing a button that shows the preview icon of the hair/skin coloured with the current element hair and skin colors.

By pressing the button, in a dropdown we show the actual editor, which presents two mode: simple and advanced.

The simple mode shows a set of preset skin/hair combination, which include the most common races or skin/hair combinations. This is a set of 8 predefined (skin, hair) values.

A "More options/less options" small button/link allows to swithch between simple and advanced mode.
In the advanced mode the user can pick a specific color for hair and skin: this advanced editor contains 3 sections: 
- a set of proposed colors for the hairs
- the preview by using our face.svg
- a set of proposed colors for the skin.

There is no way for the user to pick a custom color.


### Kit editor

The kit editor allows to modify the player kit. Just like for the skin, we present a button/icon with the preview. The preview will be based on @assets/kit.svg which is a complex SVG with paths tagged with classes:

base_tshirt
shorts
h_stripe
v_stripe

which control the colors that make up the kit.

By clicking the button, we show the editor itself which is made of 3 columns:
A big preview, a controls column where we present:
- style of jersey (solid / vertical stripes / horizontal stripes / chekerboard)
- the for colors for:
  - Jersey
  - Stripes (if the style is no solid)
  - Shorts
  - Socks

In the third column we show a grid with the 4 last configured kits.
We don't forget the created kits, when the kit value is committed, we just push the designed kit to this 4-elements list with a FIFO logic.
Empty slots simply show all colors as black.
By clicking a preset, we load the values in the editor, like if the user whould have picked them by himself, without closing the editor.

For the jersey style buttons/options, use the same shirt we used for the tokens: @assets/token_tshirt.svg without the text, using white and mid gray for the stripes.

Individual colors should be solid, on color click we let the user pick the color with our stroke-like color widget.


See attached pictures for a better understanding of the UI.



## Keyboard shortcuts

We want to implement a set of keyboard shortcuts when working with the designer.

Tools

V / H	Select tool / Hand
T	Text
S	Shapes (open the shapes menu)
R	Rectangle
O	Oval
L	line / arrow (open the arrows menu)
A line / arrow 
P	Players (open the players drawer)
M Materials (open the materials drawer)
B Ball
D Pen
T Token
E	Eraser
⌘ + Z	Undo
⌘ + shift + Z	Redo

General
⌘ + C	⌘ + V	Copy / Paste
⌘ + X	Cut
⌘ + D	Duplicate
⌘ + F	Flip figure
⌥ + drag	Duplicate
⌘ + click	Select multiple objects
⌘ + ⌥ + shift + ← → ↑ ↓	Select closest object in a direction
⌘ + A	Select all
esc	Deselect, quit edit, switch to cursor
backspace	Delete
fn + ↑	Send to front
fn + ↓	Send to back
⌘ + ⌥ + shift + plus / minus	Increase / decrease object size

Navigation
← → ↑ ↓	Move objects / Canvas
⌘ +	+	Zoom in
⌘ –	–	Zoom out
⌘ + 0	Zoom to 100%
⌥ + 1	Zoom to fit
⌥ + 2	Zoom to selected object
space + drag	Move canvas
G	Toggle grid
Tab	Move focus to next object
shift + tab	Move focus to previous object
⌘ + ← → ↑ ↓	Select closest object in a direction

Text
⌘ + B	Bold


Be sure to use the proper key shortcuts on windows, the combinations provided here are for Mac.
The main menu item Help should show a dialog with all the combinations similar to the provided picture. Enable this menu item.


- copy/paste style: the properties to copy and paset are all exept for geometry (position, points, scale)
- implement, when more than a single element is selected, all the alignment tools:
  - Align left
  - Center horizontally
  - Align right
  - Distribute horizontally
  - Align top
  - Align vertically
  - Align bottom
  - Distribute vertically
- Add the alignment items to the properties panel menu (the one open with the three dots icon)


----


- Add a popover description to the arrows used in some players categories in the drawer to explain what the direction means (Players facing left, upword, downword, right).

When the background field is:
 - fields/11/49 (horizontal soccer field) 
 - fields/11/19 (vertical soccer field)
 - fields/futsal/1 (vertical futsal field)
 
 Add a menu item in the more tools that opens a submenu with all the typical game systems.
 You can find a reference of correct positions here:
 @/Users/gtoffoli/Saysource/progetti/Youcoach/GIT/youcoachapp2/client/src/core/components/matches/pre-match/formations.ts

Reference area of each field on the board:
- fields/11/49
<rect x="33" y="90" width="1120" height="719"></rect>

- fields/11/19
<rect x="327" y="27" width="546" height="851"></rect>

- fields/futsal/1
<rect x="409" y="85" width="376" height="732"></rect>

Once the user clicks a game systems (i.e. 4-3-3), we show a window where the user can pick
 - The direction (from left to right / right to left for horizontal fields, from bottom to top or top to bottom for vertical field)
 - The token style: if there are tokens already in the canvas, propose them as options, if less than two, fill the options with a solid red (#e37268) and solid blue (#799eed)
 
After the choice of direction and style we add the tokens to the canvas (11 for soccer, 5 for futsal) accordingly with the coordinates.

Ideally, the available "Game system" should be defined at field level, so we can define not only which game systems are available, but also complex setups (typical rondos 5vs5, attack situation 3vs2, etc...)


## Snap to Objects

Snap to object should be activated by using a special combonation: ⌥ + S
or by selecting the menu Preferences > Snap to objects from the main menu, to be added after Keyboard Shortcuts menu item.

The implementation should follow the same logic implemented in Excalidraw for what concerns the snap to object: when enabled, moving an element on the page will be subject to magnetic effect on notable points: center of elements, corners of elements, equidistance from elements.
Lines will be drawn to highlight the snap and the equality of discance between objects.
If the user is moving multiple objects at time, the bounding box of the selection will be affected by the snap, not it's contained objects.

Check the pictures for a clear idea of how the lines are drawn in Excalidraw.


## Lasso selection

Lasso selection should be added to the More Tools menu, and allows to draw the selection with a free drawing.
All the elements that event temporarily are hit from the closed curve drawn by the user are immediately selected.


## Arrow 3D

The last element we want to add to our designer are the 3D arrows.
This is a real 3D object shown in the designer by means of three.js
The object is create dynamicall, so we can have full control on curve, height, thickness, color, opacity, etc..
The arrow and the options that can be controlled is implemented in this file inside YouCoach Video Analysis, and we will take the idea for the implementation:
@/Users/gtoffoli/Saysource/progetti/Youcoach/GIT/youcoachvideo/client/src/presentation/canvas/Layer3D.tsx

The arrow should have 3 control points: start position, end position and height handle.
The geometry creation can be copied from this file:
@/Users/gtoffoli/Saysource/progetti/Youcoach/GIT/youcoachvideo/client/src/presentation/figures/arrows3Dutils.ts

Properties of the arrow:
- stickWidth: number (this is actually always )
- thickness: number,
- tipWidth: number,
- tipLength: number,
- splineWidth: number,
- splineHeight: number,
- splineLength: number,
- x: number, // x Position of the arrow in the scene
- z: number, // Vector3(x, 0, y)
- y: number  // Rotation in Rads around y axis (fixed at x,z)  (0, y, 0)

Here are some defaults we use in youcoach video analysis:

rrowElement.stickWidth = 0.3;
arrowElement.thickness = 0.05;
arrowElement.tipWidth = 0.15;
arrowElement.tipLength = 0.5;
arrowElement.splineWidth = 8;
arrowElement.splineHeight = 3;
arrowElement.splineLength = 1;
element.fill = '#FF0000';
arrowElement.x = -3;
arrowElement.z = 3;
arrowElement.y = -Math.PI/4;


## Homography

The result of the arrows is fantastic, so fantastic that the next natural step would by to try mapping the real prospective of the plan on which the arrows sit.

This is tricky because each fiels was designed by hand with simple SVG drawings.

My proposal is to create a small tool to eventually calculate an homogrfic matrix so that the 3D plane matches the field prospective.

We use essentially 3 type of fields:
1. soccer 11
2. training small field
3. futsal

How the tool works:

1. we define notable points on a 2D top view image of a field, which will be the base reference
2. we mark the points on the image

With enough points, and the assumption that each points are at the same 0 quote, we can adjust the field prospective.

Does this make sense?

The homography matric could then be part of the field information.


'images/optimized/fields/11/0.svg': { ref: 'area', position: [20, 45.3, -20.92], target: [20, 0, 12], fov: 36 },

'images/optimized/fields/11/32.svg': { ref: 'area', position: [20, 55.99, 15.98], target: [20, 0, 15], fov: 35 },

'images/optimized/fields/11/44.svg': { ref: 'area', position: [20, 48.98, 45.65], target: [20, 0, 18.5], fov: 33 },

'images/optimized/fields/11/1.svg': { ref: 'soccer11', position: [52.5, 119, -63.17], target: [52.5, 0, 26.5], fov: 36 },

'images/optimized/fields/11/2.svg': { ref: 'soccer11', position: [34.53, 19.08, 34], target: [4, 0, 34], fov: 23 },

'images/optimized/fields/11/3.svg': { ref: 'soccer11', position: [54.74, 38.64, 34], target: [9.5, 0, 34], fov: 30 },

'images/optimized/fields/11/4.svg': { ref: 'soccer11', position: [52.28, 28.28, 23], target: [24, 0, 23], fov: 49.5 },

'images/optimized/fields/11/5.svg': { ref: 'soccer11', position: [53.15, 32.87, 34], target: [27, 0, 34], fov: 49.5 },

'images/optimized/fields/11/6.svg': { ref: 'soccer11', position: [36.57, 29.02, 34], target: [17, 0, 34], fov: 49.5 },

'images/optimized/fields/11/7.svg': { ref: 'soccer11', position: [119.74, 77.47, 34], target: [66.5, 0, 34], fov: 50.5 },

'images/optimized/fields/11/8.svg': { ref: 'area', position: [20, 59.59, -9.68], target: [20, 0, 15], fov: 30 },

'images/optimized/fields/11/9.svg': { ref: 'area', position: [20, 50.57, -32.46], target: [20, 0, 11.5], fov: 30.5 },

'images/optimized/fields/11/10.svg': { ref: 'area', position: [20, 50.57, -32.46], target: [20, 0, 11.5], fov: 30.5 },

'images/optimized/fields/11/10.svg': { ref: 'soccer11', position: [52.5, 133.08, -96.44], target: [52.5, 0, 25.5], fov: 30 },

'images/optimized/fields/11/11.svg': { ref: 'area', position: [20, 49.43, -30.21], target: [20, 0, 12], fov: 31.5 },

'images/optimized/fields/11/12.svg': { ref: 'soccer11', position: [72.73, 51.91, 5.62], target: [73, 0, 31.5], fov: 54 },

'images/optimized/fields/11/14.svg': { ref: 'soccer11', position: [79.14, 54.7, 9.32], target: [79.5, 0, 43.5], fov: 42.5 },

'images/optimized/fields/11/15.svg': { ref: 'soccer11', position: [51.86, 84.54, -36.92], target: [52.5, 0, 24.5], fov: 51.5 },

'images/optimized/fields/11/46.svg': { ref: 'soccer11', position: [69.19, 60.67, 13.91], target: [69.5, 0, 43.5], fov: 52 },

'images/optimized/fields/11/16.svg': { ref: 'soccer11', position: [76.08, 49.35, -9.46], target: [76.5, 0, 30.5], fov: 52 },

'images/optimized/fields/11/22.svg': { ref: 'soccer11', position: [145.23, 84.52, 34], target: [78, 0, 34], fov: 30 },

'images/optimized/fields/11/23.svg': { ref: 'soccer11', position: [133.43, 60.26, 34], target: [85.5, 0, 34], fov: 30 },

'images/optimized/fields/11/24.svg': { ref: 'soccer11', position: [118.41, 45.29, 23], target: [89, 0, 23], fov: 37 },

'images/optimized/fields/11/25.svg': { ref: 'soccer11', position: [114.61, 30.19, 34], target: [95, 0, 34], fov: 37 },

'images/optimized/fields/11/26.svg': { ref: 'soccer11', position: [18.69, 41.11, 56.75], target: [17.5, 0, 34], fov: 39 },

'images/optimized/fields/11/26.svg': { ref: 'soccer11', position: [20, 47.02, 76.57], target: [20, 0, 38.5], fov: 35 },

'images/optimized/fields/11/27.svg': { ref: 'soccer11', position: [139.62, 104.77, 33.5], target: [63.5, 0, 33.5], fov: 37 },

'images/optimized/fields/11/28.svg': { ref: 'soccer11', position: [51.23, 64.42, 33.5], target: [26.5, 0, 33.5], fov: 45.5 },

'images/optimized/fields/11/29.svg': { ref: 'soccer11', position: [37.19, 57.7, 33.5], target: [19, 0, 33.5], fov: 41.5 },

'images/optimized/fields/11/30.svg': { ref: 'soccer11', position: [22.89, 43.27, 33.5], target: [12.5, 0, 33.5], fov: 41.5 },

'images/optimized/fields/11/31.svg': { ref: 'soccer11', position: [21.5, 29.46, 34], target: [9, 0, 34], fov: 41.5 },

'images/optimized/fields/11/33.svg': { ref: 'soccer11', position: [45.26, 53.23, 25], target: [21, 0, 25], fov: 42 },

'images/optimized/fields/11/34.svg': { ref: 'soccer11', position: [29.26, 34.58, 22.5], target: [13.5, 0, 22.5], fov: 46.5 },

'images/optimized/fields/11/35.svg': { ref: 'soccer11', position: [162.92, 104.18, 34], target: [75.5, 0, 34], fov: 25 },

'images/optimized/fields/11/36.svg': { ref: 'soccer11', position: [126.76, 86.87, 34], target: [82.5, 0, 34], fov: 27 },

'images/optimized/fields/11/37.svg': { ref: 'soccer11', position: [134.46, 77.06, 26], target: [81.5, 0, 26], fov: 29 },

'images/optimized/fields/11/38.svg': { ref: 'soccer11', position: [123.59, 70.84, 28.5], target: [87.5, 0, 28.5], fov: 29 },

'images/optimized/fields/11/39.svg': { ref: 'soccer11', position: [110.5, 79.09, -17.7], target: [64, 0, 28], fov: 50.5 },

'images/optimized/fields/11/40.svg': { ref: 'soccer11', position: [90.84, 89.5, -25.48], target: [32, 0, 27.5], fov: 31 },

'images/optimized/fields/11/41.svg': { ref: 'area', position: [20, 65.33, -19.07], target: [20, 0, 13.5], fov: 26.5 },

'images/optimized/fields/11/42.svg': { ref: 'area', position: [20, 54.72, -48.72], target: [20, 0, 11], fov: 26.5 },

'images/optimized/fields/11/43.svg': { ref: 'area', position: [20, 54.32, -44.28], target: [20, 0, 11], fov: 26.5 },

'images/optimized/fields/11/46.svg': { ref: 'soccer11', position: [28, 71.88, 91.87], target: [28, 0, 26], fov: 30 },

'images/optimized/fields/11/47.svg': { ref: 'area', position: [48.93, 14.87, -15.1], target: [28, 0, 17.5], fov: 30 },



Ok, good job.

Now, due to compatibility, we need to keep these fields manually krafted and roughly mapped.
The idea is to keep them, but hide them from the palette, and instead propose presets of a real 3D field managed with by three.js

Here is a rought implementation of the field with the goals.
@/Users/gtoffoli/Library/Application Support/Claude/local-agent-mode-sessions/4b7bba99-8846-4e09-843c-3fd7a009438b/0b379b57-b62e-4bf5-99e7-297d284a2f7d/local_72a1a62f-fb49-4ea3-ac54-54f322bad2fe/outputs

The ball is terrible, but you can keep the field.

The new rendering sandwich:

- Field0 image background or solid background defined by the user
- 3D scene with the field, which position should be editable with intuitive simple controls when edit background is enabled
- 2D SVG layer 1
- 3D scene for objects (we only have the arrow)
- 2D SVG layer 2 (for elements on top of the 3D and selection figures)

we would have to manage some sort of virtual z-order to tell if an items goes to layer 1 or layer 2.

In the fields palette we will provide a set of available fields which are simply predefined positions of the 3D field, defined like we did earlier:
{ ref: 'soccer11', position: [28, 71.88, 91.87], target: [28, 0, 26], fov: 30 }

Controls:
Orbit controls are good, but most user simply don't get it, especially coaches.
Here are controls that make sense:

rotate (on Y axis, on step of 15 degrees)
tilt (45 - 90) 
zoom in
zoom out
pan forward
pan backward
Reset

FOV fixed at 50.



## Field lines and background

The lines are currently rasterized as texture, and the quality of the texture degrades quickly.
What could be a viable solution? Since the field is made of a path, would the Three.js's built-in SVGLoader help? Maybe we can transform it to a 3D geometry.
This also would help with the second requirement: the texture currently fill the field with a s a solid green background with alternate green bands. We want the field to be transparent, just the white lines, and just add semi-transparent white bands which would have the effect of shading the background. the bands should extend for an entra 20% of the field size, to cover a larger surface.


## Elements on the 3D space

Think well, since you are an expert in 3D.
Right now, when we add an element, its references are based on the container SVG.
We would like to store the position of the element in the 3D space as well (actually only [x,0,z])
so that if the user change the field, we may show the shapes on the same original position in the new field space.
Technically, the right position to use for figures would be the bottom center point.
This may also impact the scale of the figure, and this is up to you make a proposal.

Right now players and materials use a scale factor based on the field definition and are simply placed on an 
We want to define a factor the can then be applied to drawing, i.e. 0.8 the height of the goal in the current pose.

### Proposal (implemented) — ground anchor + perspective scale

**Model.** Standing elements (`figure`, `token`) gain one optional field: `ground: [x, z]` — the
element's anchor on the pitch ground plane, in world **metres** (y is always 0, so we store only the
two ground coordinates, exactly as the spec asks). The anchor is the figure's **bottom-center** (its
"feet"), because that is the point that actually touches the grass. `ground` is absent on shapes,
lines, text and 3D arrows (arrows already carry their own 3D placement).

**The board still owns 2D.** Elements keep their existing 2D box (`x/y/width/height` + `transform`);
nothing about rendering, hit-testing, selection or export changes. `ground` is a *pin*: it records
where on the pitch the element sits so we can recompute its 2D placement when the **field camera**
(`background.field3d`) changes. The bijection board↔ground is the existing projection: a figure's
bottom-center in board units is `projectToBoard(ground, camera)`, and `boardToGround(bottomCenter,
camera)` recovers the anchor (both already used by the 3D-arrow tool).

**Keeping it in sync.** The field camera only ever changes inside *Edit-Background* (orbit, zoom,
zone-pick, reset — all coalesced into one undo step). So:
  1. On **entering** Edit-Background we (re)derive each standing element's `ground` from its current
     board bottom-center through the current camera. This self-heals any staleness from ordinary
     (fixed-camera) editing — moves, duplicates, paste — with no per-edit bookkeeping.
  2. On **every camera change** we reproject each pinned element: its new bottom-center is
     `projectToBoard(ground, newCamera)`, so figures stay glued to their pitch spot as you orbit or
     switch fields. This lives in the store's `setBackground`, the single choke point every camera
     change flows through.

**Scale.** A player standing in a zoomed-in box should look proportionally bigger than the same
player on a full-pitch view — the figure scales with how magnified the pitch is at *its* location.
We measure that magnification as the **ground pixels-per-metre** at the anchor: project a 1 m × 1 m
ground quad at `ground` and take √(its projected area) — a direction-averaged, perspective-correct
board-units-per-metre that (unlike a vertical yard-stick) stays well-defined even in a top-down view.
On a camera change each figure's `transform.scale` is multiplied by `ppm(newCamera)/ppm(oldCamera)`.
Because `setBackground` always sees the true previous camera, this ratio is exact and self-correcting
(no drift, even across hundreds of orbit frames), and it naturally supersedes the legacy per-field
`figureScale` for real 3D fields.

**Metric size — now stored (was a ratio).** Each standing element also stores `sizeM`, its
real-world height in metres, captured (alongside `ground`) from its board size and the ground-ppm at
enter-Edit-Background. Scale is then derived ABSOLUTELY under any camera as `sizeM × ppm(camera) /
localHeight`, rather than by multiplying a per-step ppm ratio. This was originally the deferred
"0.8 × goal height" idea; it became necessary for correctness: the incremental ratio accumulated, and
a single degenerate step (a figure passing behind the camera while zooming, where ppm collapses and
hits the scale clamp) broke the telescoping and left the figure stuck tiny even after it came back
into view. The absolute form is self-correcting — each camera recomputes size from the stable `sizeM`
— and `ppm` itself uses the same near-plane w-clamped projection as positions, so a spot near/behind
the camera can't produce a bogus magnification. `sizeM` is re-derived each enter so a manual resize
heals, and it opens the door to a coach-facing "size in real-world terms" control later.

### Rectangles + polylines — points stick to the field surface (implemented)

Area/path shapes are pinned **per point**, not by a single anchor: `PolylineElement` gains
`ground: [x, z][]` (one ground anchor per `points` entry). On a camera change each point is
re-placed at `projectToBoard(ground[i], newCamera)` and baked straight into `points` (with the
transform reset to identity, opacity kept), so the shape genuinely **warps** to lie on the grass — a
pitch rectangle seen obliquely becomes a foreshortened trapezoid, exactly as a flat marking would.
Because only a polygon can warp, a **rectangle is converted to an equivalent closed 4-point polyline**
the moment it's pinned (on entering Edit-Background, id/style preserved) — after that it behaves like
any other pinned polyline. Both the conversion and the per-element ground derivation happen in one
undoable `pinSetup` step just before the field-edit transaction (idempotent, so re-entry is a no-op;
staleness from ordinary fixed-camera edits heals because the anchors are re-derived from the current
points each time).

**Ovals** pin the same way: an `ellipse` is sampled into a 20-point **smooth** (`curve: true`) closed
polyline (`ellipseToPolyline`, the ellipse analog of `rectToPolyline`) when pinned, then warps
per-point like any polyline — an oval on the grass foreshortens into a tilted oval under an oblique
camera, staying smooth through the warp. **Tokens** were already covered by the standing-element pin
(single bottom-center anchor + ground-ppm scale), same as figures. `draw` (freehand) remains out of
scope.

