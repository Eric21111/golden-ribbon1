import { useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { FormField } from './FormField';

type Props = {label: string; value: string; onChangeText: (value: string) => void; error?: string; allowPassword?: boolean; onLegacyChange?: (legacy: boolean) => void};
export function PinField({label, value, onChangeText, error, allowPassword, onLegacyChange}: Props) {
  const refs = useRef<Array<TextInput | null>>([]);
  const [legacy, setLegacy] = useState(false);
  const [focused, setFocused] = useState(-1);
  return <View style={{gap: 8}}>
    {legacy ? <FormField label="Current beta password" value={value} onChangeText={onChangeText} secureTextEntry autoCapitalize="none" autoCorrect={false} /> : <>
      <Text style={{fontWeight:'600'}}>{label}</Text>
      <View style={{flexDirection:'row', gap:6}}>
        {Array.from({length:6}, (_, index) => <TextInput key={index}
          ref={el => {refs.current[index] = el;}}
          accessibilityLabel={label + ', digit ' + (index + 1) + ' of 6'}
          style={{flex:1,minWidth:0,height:46,textAlign:'center',fontSize:19,borderWidth:1,borderRadius:8,borderColor:focused===index?'#68429A':'#8991A2'}}
          value={value[index] ?? ''} secureTextEntry keyboardType="number-pad" selectTextOnFocus autoComplete="off"
          onFocus={() => {setFocused(index); if(index>value.length) refs.current[value.length]?.focus();}}
          onBlur={() => setFocused(-1)}
          onKeyPress={({nativeEvent}) => {
            if(nativeEvent.key==='Backspace' && !value[index] && index>0) {
              onChangeText(value.slice(0,index-1)); refs.current[index-1]?.focus();
            }
          }}
          onChangeText={digits => {
            if (!/^[0-9]*$/.test(digits)) return;
            if (!digits) {
              onChangeText(value.slice(0,index) + value.slice(index+1));
              refs.current[Math.max(0,index-1)]?.focus(); return;
            }
            const part=digits.slice(0,6-index);
            onChangeText((value.slice(0,index)+part+value.slice(index+part.length)).slice(0,6));
            refs.current[Math.min(5,index+part.length)]?.focus();
          }} />)}
      </View>
    </>}
    {allowPassword && <Pressable accessibilityRole="button" onPress={() => {onChangeText('');setLegacy(!legacy);onLegacyChange?.(!legacy);}}>
      <Text style={{color:'#364D82',paddingVertical:5}}>{legacy?'Use six-digit PIN':'Still using a beta password?'}</Text>
    </Pressable>}
    {!!error && <Text accessibilityRole="alert" style={{color:'#A11B28'}}>{error}</Text>}
  </View>;
}
